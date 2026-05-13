import { NavLink } from 'react-router-dom';

const items = [
  { to: '/',          label: 'Overview' },
  { to: '/mtplx',     label: 'MTPLX metrics' },
  { to: '/opencode',  label: 'OpenCode' },
  { to: '/system',    label: 'Computer' },
  { to: '/restarts',  label: 'Restarts' },
];

export default function Nav() {
  return (
    <nav className="nav">
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}
