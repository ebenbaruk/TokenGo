// Coquille des pages publiques (Lab, Pulse, About) : en-tête avec logo et navigation, contenu défilant.
import type { ReactNode } from 'react';
import s from './PageShell.module.css';

const LINKS = [
  { href: '/', label: 'Play' },
  { href: '/pulse', label: 'Pulse' },
  { href: '/lab', label: 'Lab' },
  { href: '/about', label: 'About' },
];

export function PageShell({ title, subtitle, children, wide = true, testId }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean; testId?: string }) {
  const here = location.pathname;
  return (
    <div className={s.page} data-testid={testId}>
      <header className={s.top}>
        <a href="/" className={s.logo} aria-label="TokenGo home"><img src="/art/logo.png" alt="TokenGo" width={720} height={170} /></a>
        <nav className={s.nav}>
          {LINKS.map((l) => <a key={l.href} href={l.href} className={here === l.href ? s.on : undefined}>{l.label}</a>)}
        </nav>
      </header>
      <main className={`${s.main} ${wide ? s.wide : ''}`}>
        <div className={s.titleRow}>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {children}
      </main>
    </div>
  );
}
