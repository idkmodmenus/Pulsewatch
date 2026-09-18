// Imported first by every test file: config is parsed at import time, so the environment
// has to be in place before any application module loads.
process.env.DATABASE_URL ??= 'postgres://pulsewatch:pulsewatch@127.0.0.1:5432/pulsewatch_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.LOG_LEVEL ??= 'error';
process.env.ALLOW_PRIVATE_TARGETS ??= 'false';
