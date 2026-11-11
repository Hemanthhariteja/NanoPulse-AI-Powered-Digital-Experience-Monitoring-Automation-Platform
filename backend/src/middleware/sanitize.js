/**
 * Removes keys that start with "$" or contain "." from request bodies/queries so user input
 * can never smuggle MongoDB operators into a query, even if a route forgot to validate.
 */
function clean(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) delete value[key];
    else value[key] = clean(value[key], depth + 1);
  }
  return value;
}

export function sanitizeInput(req, _res, next) {
  if (req.body) clean(req.body);
  if (req.query) clean(req.query);
  next();
}
