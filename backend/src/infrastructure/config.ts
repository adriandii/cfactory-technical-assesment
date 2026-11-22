export interface S3Config {
  /** Omit for AWS S3; set for S3-compatible servers such as SILO. */
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Config {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  s3: S3Config;
  workerConcurrency: number;
}

/** Reads and validates the environment once at startup, so a bad deploy fails fast and names the variable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  const positiveInt = (name: string, fallback: number): number => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
    return value;
  };

  return {
    port: positiveInt('PORT', 3000),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    s3: {
      endpoint: env.S3_ENDPOINT?.trim() || undefined,
      region: env.S3_REGION?.trim() || 'us-east-1',
      bucket: required('S3_BUCKET'),
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    workerConcurrency: positiveInt('WORKER_CONCURRENCY', 1),
  };
}
