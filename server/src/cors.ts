export function getCorsOrigins(): string[] {
  if (process.env.CORS_ORIGIN) {
    return process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
  }
  return ['http://localhost:5173', 'http://127.0.0.1:5173'];
}
