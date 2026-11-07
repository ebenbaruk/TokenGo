/** API impérative minimale de la carte pour le HUD (recentrer), sans importer MapLibre. */
export const mapCtl = {
  recenter: () => {}, isFollowing: () => true, onFollowChange: (_f: boolean) => {},
  /** montre un point (ex. zone d'un événement) puis revient sur le joueur au bout de quelques secondes */
  lookAt: (_p: { lat: number; lng: number }, _zoom?: number) => {},
};
