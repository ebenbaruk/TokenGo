//! TokenGo multi-token contract — homemade NEP-245 (see Docs/06-blockchain.md §2).
//!
//! Custodial model: the game backend (`operator_id`) mints, burns and moves tokens in
//! batches; players' sub-accounts can still `mt_transfer` their own tokens.
//! `mt_transfer_call` is intentionally not supported.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableSet, LookupMap, LookupSet};
use near_sdk::{assert_one_yocto, env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub type TokenId = String;

/// The only token ids this contract knows about.
pub const TOKEN_IDS: [&str; 6] = [
    "flux",
    "shard:deepseek",
    "shard:qwen",
    "shard:gemini",
    "shard:gpt",
    "shard:claude",
];

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Balances,
    Supply,
    TokenIds,
    Settlements,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    operator_id: AccountId,
    balances: LookupMap<(AccountId, TokenId), u128>,
    supply: LookupMap<TokenId, u128>,
    token_ids: IterableSet<TokenId>,
    paused: bool,
    settlements: LookupSet<String>,
}

/// NEP-245 `Token` (no per-token metadata: these are fungible-style ids).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Token {
    pub token_id: TokenId,
    pub owner_id: Option<AccountId>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MintBurnEntry {
    pub owner_id: AccountId,
    pub token_id: TokenId,
    pub amount: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TransferEntry {
    pub from: AccountId,
    pub to: AccountId,
    pub token_id: TokenId,
    pub amount: U128,
}

/// One operation of a settlement batch: `{"kind":"mint","owner_id":…,"token_id":…,"amount":"3","memo":…}`.
#[near(serializers = [json])]
#[serde(tag = "kind", rename_all = "snake_case")]
#[derive(Clone, Debug)]
pub enum Op {
    Mint { owner_id: AccountId, token_id: TokenId, amount: U128, memo: Option<String> },
    Burn { owner_id: AccountId, token_id: TokenId, amount: U128, memo: Option<String> },
    Transfer { from: AccountId, to: AccountId, token_id: TokenId, amount: U128, memo: Option<String> },
}

/// Collects event data during a call, then writes ONE `EVENT_JSON` log per event type.
#[derive(Default)]
struct Events {
    mint: Vec<Value>,
    burn: Vec<Value>,
    transfer: Vec<Value>,
}

impl Events {
    fn emit(self) {
        for (name, mut data) in [("mt_mint", self.mint), ("mt_burn", self.burn), ("mt_transfer", self.transfer)] {
            if data.is_empty() {
                continue;
            }
            for d in data.iter_mut().filter(|d| d["memo"].is_null()) {
                d.as_object_mut().unwrap().remove("memo"); // NEP-245: memo is optional
            }
            let event = json!({ "standard": "nep245", "version": "1.0.0", "event": name, "data": data });
            env::log_str(&format!("EVENT_JSON:{}", serde_json::to_string(&event).unwrap()));
        }
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId) -> Self {
        let mut token_ids = IterableSet::new(StorageKey::TokenIds);
        for id in TOKEN_IDS {
            token_ids.insert(id.to_string());
        }
        Self {
            owner_id,
            operator_id,
            balances: LookupMap::new(StorageKey::Balances),
            supply: LookupMap::new(StorageKey::Supply),
            token_ids,
            paused: false,
            settlements: LookupSet::new(StorageKey::Settlements),
        }
    }

    // ---------- owner ----------

    pub fn set_operator(&mut self, operator_id: AccountId) {
        self.assert_owner();
        self.operator_id = operator_id;
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }

    pub fn get_config(&self) -> Value {
        json!({ "owner_id": self.owner_id, "operator_id": self.operator_id, "paused": self.paused })
    }

    pub fn is_settled(&self, settlement_id: String) -> bool {
        self.settlements.contains(&settlement_id)
    }

    // ---------- operator ----------

    pub fn op_mint_batch(&mut self, entries: Vec<MintBurnEntry>, memo: Option<String>) {
        self.assert_operator();
        let mut ev = Events::default();
        for e in entries {
            self.mint(e.owner_id, e.token_id, e.amount.0, memo.clone(), &mut ev);
        }
        ev.emit();
    }

    pub fn op_burn_batch(&mut self, entries: Vec<MintBurnEntry>, memo: Option<String>) {
        self.assert_operator();
        let mut ev = Events::default();
        for e in entries {
            self.burn(e.owner_id, e.token_id, e.amount.0, memo.clone(), &mut ev);
        }
        ev.emit();
    }

    pub fn op_transfer_batch(&mut self, entries: Vec<TransferEntry>, memo: Option<String>) {
        self.assert_operator();
        let mut ev = Events::default();
        let authorized = Some(self.operator_id.clone());
        for e in entries {
            self.transfer(e.from, e.to, e.token_id, e.amount.0, authorized.clone(), memo.clone(), &mut ev);
        }
        ev.emit();
    }

    /// Applies a whole batch of ops atomically (any panic reverts everything).
    /// Idempotent: a `settlement_id` can only be applied once.
    pub fn op_settle(&mut self, ops: Vec<Op>, settlement_id: String) {
        self.assert_operator();
        require!(self.settlements.insert(settlement_id.clone()), "settlement already applied");
        let mut ev = Events::default();
        let authorized = Some(self.operator_id.clone());
        for op in ops {
            match op {
                Op::Mint { owner_id, token_id, amount, memo } => {
                    self.mint(owner_id, token_id, amount.0, memo, &mut ev)
                }
                Op::Burn { owner_id, token_id, amount, memo } => {
                    self.burn(owner_id, token_id, amount.0, memo, &mut ev)
                }
                Op::Transfer { from, to, token_id, amount, memo } => {
                    self.transfer(from, to, token_id, amount.0, authorized.clone(), memo, &mut ev)
                }
            }
        }
        ev.emit();
    }

    // ---------- NEP-245 core ----------

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        self.mt_batch_transfer(receiver_id, vec![token_id], vec![amount], approval.map(|a| vec![Some(a)]), memo)
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(!self.paused, "paused");
        require!(approvals.is_none(), "approvals not supported");
        require!(!token_ids.is_empty() && token_ids.len() == amounts.len(), "token_ids/amounts mismatch");
        let sender = env::predecessor_account_id();
        require!(sender != receiver_id, "sender and receiver must differ");
        let mut ev = Events::default();
        for (token_id, amount) in token_ids.into_iter().zip(amounts) {
            self.transfer(sender.clone(), receiver_id.clone(), token_id, amount.0, None, memo.clone(), &mut ev);
        }
        ev.emit();
    }

    #[payable]
    pub fn mt_transfer_call(&mut self) {
        env::panic_str("mt_transfer_call not supported");
    }

    #[payable]
    pub fn mt_batch_transfer_call(&mut self) {
        env::panic_str("mt_transfer_call not supported");
    }

    pub fn mt_token(&self, token_ids: Vec<TokenId>) -> Vec<Option<Token>> {
        token_ids
            .into_iter()
            .map(|token_id| self.token_ids.contains(&token_id).then(|| Token { token_id, owner_id: None }))
            .collect()
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: TokenId) -> U128 {
        U128(self.balance(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<TokenId>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(self.balance(&account_id, t))).collect()
    }

    pub fn mt_supply(&self, token_id: TokenId) -> Option<U128> {
        self.token_ids.contains(&token_id).then(|| U128(self.supply.get(&token_id).copied().unwrap_or(0)))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<TokenId>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|t| self.mt_supply(t)).collect()
    }

    pub fn mt_tokens(&self, from_index: Option<U128>, limit: Option<u32>) -> Vec<Token> {
        let from = from_index.map_or(0, |i| i.0 as usize);
        let limit = limit.map_or(usize::MAX, |l| l as usize);
        self.token_ids
            .iter()
            .skip(from)
            .take(limit)
            .map(|t| Token { token_id: t.clone(), owner_id: None })
            .collect()
    }

    // ---------- internals ----------

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "only owner");
    }

    fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator_id, "only operator");
        require!(!self.paused, "paused");
    }

    fn assert_token(&self, token_id: &TokenId) {
        require!(self.token_ids.contains(token_id), "unknown token_id");
    }

    fn balance(&self, account_id: &AccountId, token_id: &TokenId) -> u128 {
        self.balances.get(&(account_id.clone(), token_id.clone())).copied().unwrap_or(0)
    }

    fn set_balance(&mut self, account_id: AccountId, token_id: TokenId, amount: u128) {
        if amount == 0 {
            self.balances.remove(&(account_id, token_id));
        } else {
            self.balances.insert((account_id, token_id), amount);
        }
    }

    fn mint(&mut self, owner: AccountId, token_id: TokenId, amount: u128, memo: Option<String>, ev: &mut Events) {
        self.assert_token(&token_id);
        require!(amount > 0, "amount must be positive");
        let bal = self.balance(&owner, &token_id).checked_add(amount).expect("balance overflow");
        self.set_balance(owner.clone(), token_id.clone(), bal);
        let supply = self.supply.get(&token_id).copied().unwrap_or(0) + amount;
        self.supply.insert(token_id.clone(), supply);
        ev.mint.push(json!({ "owner_id": owner, "token_ids": [token_id], "amounts": [amount.to_string()], "memo": memo }));
    }

    fn burn(&mut self, owner: AccountId, token_id: TokenId, amount: u128, memo: Option<String>, ev: &mut Events) {
        self.assert_token(&token_id);
        require!(amount > 0, "amount must be positive");
        let bal = self.balance(&owner, &token_id);
        require!(bal >= amount, "burn exceeds balance");
        self.set_balance(owner.clone(), token_id.clone(), bal - amount);
        let supply = self.supply.get(&token_id).copied().unwrap_or(0) - amount;
        self.supply.insert(token_id.clone(), supply);
        ev.burn.push(json!({
            "owner_id": owner, "authorized_id": self.operator_id,
            "token_ids": [token_id], "amounts": [amount.to_string()], "memo": memo
        }));
    }

    #[allow(clippy::too_many_arguments)]
    fn transfer(
        &mut self,
        from: AccountId,
        to: AccountId,
        token_id: TokenId,
        amount: u128,
        authorized_id: Option<AccountId>,
        memo: Option<String>,
        ev: &mut Events,
    ) {
        self.assert_token(&token_id);
        require!(amount > 0, "amount must be positive");
        require!(from != to, "sender and receiver must differ");
        let from_bal = self.balance(&from, &token_id);
        require!(from_bal >= amount, "insufficient balance");
        self.set_balance(from.clone(), token_id.clone(), from_bal - amount);
        let to_bal = self.balance(&to, &token_id) + amount;
        self.set_balance(to.clone(), token_id.clone(), to_bal);
        let mut data = json!({
            "old_owner_id": from, "new_owner_id": to,
            "token_ids": [token_id], "amounts": [amount.to_string()], "memo": memo
        });
        if let Some(a) = authorized_id {
            data["authorized_id"] = json!(a);
        }
        ev.transfer.push(data);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::{testing_env, NearToken};

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(predecessor: &str, deposit: u128) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(acc(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build());
    }

    fn setup() -> Contract {
        ctx("owner.testnet", 0);
        Contract::new(acc("owner.testnet"), acc("op.testnet"))
    }

    fn mint(owner: &str, token: &str, amount: u128) -> Op {
        Op::Mint { owner_id: acc(owner), token_id: token.into(), amount: U128(amount), memo: None }
    }

    fn events(name: &str) -> Vec<Value> {
        get_logs()
            .iter()
            .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
            .map(|j| serde_json::from_str::<Value>(j).unwrap())
            .filter(|v| v["event"] == name)
            .collect()
    }

    #[test]
    #[should_panic(expected = "only operator")]
    fn only_operator_can_mint() {
        let mut c = setup();
        ctx("alice.testnet", 0);
        c.op_settle(vec![mint("alice.testnet", "flux", 10)], "s1".into());
    }

    #[test]
    #[should_panic(expected = "only owner")]
    fn only_owner_can_set_operator() {
        let mut c = setup();
        ctx("op.testnet", 0);
        c.set_operator(acc("op.testnet"));
    }

    #[test]
    #[should_panic(expected = "paused")]
    fn paused_blocks_operator() {
        let mut c = setup();
        c.set_paused(true);
        ctx("op.testnet", 0);
        c.op_mint_batch(vec![], None);
    }

    #[test]
    fn settle_applies_ops_and_emits_one_event_per_type() {
        let mut c = setup();
        ctx("op.testnet", 0);
        let ops = vec![
            mint("alice.testnet", "shard:deepseek", 3),
            mint("alice.testnet", "flux", 10),
            Op::Burn { owner_id: acc("alice.testnet"), token_id: "shard:deepseek".into(), amount: U128(1), memo: Some("forge:1".into()) },
            Op::Transfer { from: acc("alice.testnet"), to: acc("m-bob.testnet"), token_id: "flux".into(), amount: U128(4), memo: Some("trade:7".into()) },
        ];
        c.op_settle(ops, "s1".into());
        assert!(c.is_settled("s1".into()));
        let bal = c.mt_batch_balance_of(acc("alice.testnet"), vec!["shard:deepseek".into(), "flux".into(), "shard:gpt".into()]);
        assert_eq!(bal, vec![U128(2), U128(6), U128(0)]);
        assert_eq!(c.mt_balance_of(acc("m-bob.testnet"), "flux".into()), U128(4));
        assert_eq!(c.mt_batch_supply(vec!["shard:deepseek".into(), "flux".into(), "nope".into()]), vec![Some(U128(2)), Some(U128(10)), None]);

        assert_eq!(get_logs().len(), 3);
        let m = events("mt_mint");
        assert_eq!(m.len(), 1);
        assert_eq!(m[0]["standard"], "nep245");
        assert_eq!(m[0]["data"].as_array().unwrap().len(), 2);
        assert_eq!(m[0]["data"][0]["amounts"][0], "3");
        let b = events("mt_burn");
        assert_eq!(b[0]["data"][0]["memo"], "forge:1");
        let t = events("mt_transfer");
        assert_eq!(t[0]["data"][0]["authorized_id"], "op.testnet");
        assert_eq!(t[0]["data"][0]["new_owner_id"], "m-bob.testnet");
    }

    #[test]
    #[should_panic(expected = "settlement already applied")]
    fn settle_is_idempotent() {
        let mut c = setup();
        ctx("op.testnet", 0);
        c.op_settle(vec![mint("alice.testnet", "flux", 1)], "s1".into());
        c.op_settle(vec![mint("alice.testnet", "flux", 1)], "s1".into());
    }

    #[test]
    #[should_panic(expected = "burn exceeds balance")]
    fn burn_more_than_balance_fails() {
        let mut c = setup();
        ctx("op.testnet", 0);
        c.op_mint_batch(vec![MintBurnEntry { owner_id: acc("alice.testnet"), token_id: "flux".into(), amount: U128(2) }], None);
        c.op_burn_batch(vec![MintBurnEntry { owner_id: acc("alice.testnet"), token_id: "flux".into(), amount: U128(3) }], None);
    }

    #[test]
    #[should_panic(expected = "unknown token_id")]
    fn unknown_token_rejected() {
        let mut c = setup();
        ctx("op.testnet", 0);
        c.op_settle(vec![mint("alice.testnet", "shard:llama", 1)], "s1".into());
    }

    #[test]
    fn user_transfer_and_batch_transfer() {
        let mut c = setup();
        ctx("op.testnet", 0);
        c.op_settle(vec![mint("alice.testnet", "flux", 10), mint("alice.testnet", "shard:qwen", 5)], "s1".into());
        ctx("alice.testnet", 1);
        c.mt_transfer(acc("bob.testnet"), "flux".into(), U128(3), None, Some("gift".into()));
        c.mt_batch_transfer(acc("bob.testnet"), vec!["flux".into(), "shard:qwen".into()], vec![U128(1), U128(5)], None, None);
        assert_eq!(c.mt_batch_balance_of(acc("alice.testnet"), vec!["flux".into(), "shard:qwen".into()]), vec![U128(6), U128(0)]);
        assert_eq!(c.mt_batch_balance_of(acc("bob.testnet"), vec!["flux".into(), "shard:qwen".into()]), vec![U128(4), U128(5)]);
        let t = events("mt_transfer");
        assert_eq!(t.len(), 2); // one event per call; the batch call aggregates its 2 entries
        assert_eq!(t[0]["data"][0]["memo"], "gift");
        assert!(t[1]["data"][0].get("memo").is_none());
        assert_eq!(t[1]["data"].as_array().unwrap().len(), 2);
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn transfer_requires_one_yocto() {
        let mut c = setup();
        ctx("alice.testnet", 0);
        c.mt_transfer(acc("bob.testnet"), "flux".into(), U128(1), None, None);
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn transfer_more_than_balance_fails() {
        let mut c = setup();
        ctx("alice.testnet", 1);
        c.mt_transfer(acc("bob.testnet"), "flux".into(), U128(1), None, None);
    }

    #[test]
    fn views() {
        let c = setup();
        assert_eq!(c.mt_tokens(None, None).len(), 6);
        assert_eq!(c.mt_tokens(Some(U128(1)), Some(2))[0].token_id, "shard:deepseek");
        let t = c.mt_token(vec!["flux".into(), "x".into()]);
        assert_eq!(t[0].as_ref().unwrap().token_id, "flux");
        assert!(t[1].is_none());
        assert_eq!(c.mt_supply("flux".into()), Some(U128(0)));
    }
}
