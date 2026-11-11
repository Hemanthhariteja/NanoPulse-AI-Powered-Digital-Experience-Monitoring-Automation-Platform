// Runs before each test file, before application modules are imported.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/nanopulse_test';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-longer-than-32-characters';
process.env.LOG_LEVEL = 'error';
