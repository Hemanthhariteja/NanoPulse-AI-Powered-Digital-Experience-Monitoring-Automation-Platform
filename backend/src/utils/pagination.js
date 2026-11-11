import { z } from 'zod';

export const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export async function paginate(model, filter, { page, limit, sort, select, populate }) {
  let query = model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit);
  if (select) query = query.select(select);
  if (populate) query = query.populate(populate);
  const [data, total] = await Promise.all([query.lean(), model.countDocuments(filter)]);
  return { data, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}

/** Escape user text before using it inside a RegExp. */
export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
