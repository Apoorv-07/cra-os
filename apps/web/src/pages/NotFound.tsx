import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="text-center">
        <p className="mono text-xs text-faint">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-muted">The page you asked for does not exist or has moved.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/">
            <Button variant="primary">Go home</Button>
          </Link>
          <Link to="/app">
            <Button>Open dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
