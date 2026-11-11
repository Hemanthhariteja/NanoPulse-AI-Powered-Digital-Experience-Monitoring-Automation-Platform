import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, connect, createUser, disconnect, reset } from './helpers.js';

beforeAll(connect);
beforeEach(reset);
afterAll(disconnect);

describe('authentication', () => {
  it('lets the first user bootstrap as admin, then requires an admin', async () => {
    const first = await api().post('/api/auth/register').send({ name: 'Boot', email: 'boot@x.io', password: 'Secret123' });
    expect(first.status).toBe(201);
    expect(first.body.user.role).toBe('admin');
    expect(first.body.user.passwordHash).toBeUndefined();

    const anon = await api().post('/api/auth/register').send({ name: 'Eve', email: 'eve@x.io', password: 'Secret123' });
    expect(anon.status).toBe(401);
  });

  it('technicians cannot create users; admins can', async () => {
    await createUser('admin');
    const tech = await createUser('technician');
    const body = { name: 'New Tech', email: 'new@x.io', password: 'Secret123', role: 'technician' };
    expect((await api().post('/api/auth/register').set(tech.auth).send(body)).status).toBe(403);
    const admin = await createUser('admin');
    const ok = await api().post('/api/auth/register').set(admin.auth).send(body);
    expect(ok.status).toBe(201);
    expect((await api().post('/api/auth/register').set(admin.auth).send(body)).status).toBe(409);
  });

  it('validates passwords', async () => {
    const res = await api().post('/api/auth/register').send({ name: 'Weak', email: 'w@x.io', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('logs in with valid credentials and rejects invalid ones', async () => {
    await createUser('admin', 'login@x.io');
    const bad = await api().post('/api/auth/login').send({ email: 'login@x.io', password: 'wrong' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe('Invalid email or password');
    const unknown = await api().post('/api/auth/login').send({ email: 'nobody@x.io', password: 'Password1' });
    expect(unknown.status).toBe(401);

    const ok = await api().post('/api/auth/login').send({ email: 'LOGIN@x.io', password: 'Password1' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.user).not.toHaveProperty('passwordHash');

    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${ok.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('login@x.io');
  });

  it('rejects missing, malformed and tampered tokens', async () => {
    expect((await api().get('/api/auth/me')).status).toBe(401);
    expect((await api().get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
    const { token } = await createUser('admin');
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    expect((await api().get('/api/devices').set('Authorization', `Bearer ${tampered}`)).status).toBe(401);
  });

  it('strips Mongo operators from input', async () => {
    await createUser('admin', 'inj@x.io');
    const res = await api().post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });
});
