import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Guard for programmatic draft intake (the Muse intake client) on
// POST /api/drafts/create-from-custom.
//
// Behaviour:
// - When GAPURA_INTAKE_TOKEN is not configured the guard is inert and the
//   endpoint behaves exactly as before.
// - When a token is configured, a request passes in one of two ways:
//   1. It presents the token in the X-Gapura-Intake-Token header. The request
//      is marked (req.gapuraIntake = true) so created drafts are attributed
//      to the 'claude_intake' audit actor instead of 'studio_editor'.
//   2. It is a browser request carrying an Origin header. Such requests have
//      already passed the global origin guard, which only allows the
//      dashboard's own origin, so the Studio UI keeps working unchanged.
// - Anything else (a non-browser caller without a valid token) gets a 401.
//
// Scope note: this identifies the intake client and enables audit
// attribution. It does not change the dashboard API's existing access model.
export function createIntakeGuard({ token = '' } = {}) {
  const expected = String(token || '');
  return (req, res, next) => {
    if (!expected) return next();
    const provided = req.get?.('x-gapura-intake-token') || '';
    if (provided && safeEqual(provided, expected)) {
      req.gapuraIntake = true;
      return next();
    }
    if (req.get?.('origin')) return next();
    return res.status(401).json({ error: 'Token intake tidak valid atau tidak disertakan.' });
  };
}
