import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

export const Counter = mongoose.model('Counter', counterSchema);

/** Atomically allocate the next human-readable id, e.g. INC-000042. */
export async function nextId(name, prefix) {
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return `${prefix}-${String(c.seq).padStart(6, '0')}`;
}
