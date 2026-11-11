import { z } from 'zod';
import { badRequest } from '../utils/errors.js';

/**
 * Validate request parts against zod schemas. Parsed values are exposed on req.valid
 * (unknown keys are stripped), so controllers never read raw user input.
 */
export const validate =
  ({ body, query, params } = {}) =>
  (req, _res, next) => {
    req.valid = req.valid || {};
    for (const [part, schema] of [
      ['body', body],
      ['query', query],
      ['params', params],
    ]) {
      if (!schema) continue;
      const zodSchema = schema instanceof z.ZodType ? schema : z.object(schema);
      const result = zodSchema.safeParse(req[part] ?? {});
      if (!result.success) {
        const details = result.error.issues.map((i) => ({ path: [part, ...i.path].join('.'), message: i.message }));
        return next(badRequest(`Invalid request ${part}: ${details[0].path} — ${details[0].message}`, details));
      }
      req.valid[part] = result.data;
    }
    next();
  };

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a valid id');
