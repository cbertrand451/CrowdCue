/** Only fixed messages leave this boundary; provider errors may contain secrets. */
export class DatabaseConfigurationError extends Error {
  constructor(
    public readonly setting:
      'DATABASE_SSL' | 'DATABASE_SSL_CA' | 'DATABASE_URL',
  ) {
    super(`Invalid database configuration: ${setting}`);
  }
}

export class MigrationHistoryError extends Error {
  constructor() {
    super('Database migration history does not match this build');
  }
}

export function databaseFailure(error: unknown): string {
  if (error instanceof DatabaseConfigurationError) {
    if (error.setting === 'DATABASE_SSL_CA')
      return '[certificate_format] DATABASE_SSL_CA must contain the full PEM certificate text, not its filename.';
    if (error.setting === 'DATABASE_SSL')
      return '[ssl_setting] DATABASE_SSL must be true or false.';
    return '[connection_url] Check DATABASE_URL: use the Supabase Session pooler URI with the password placeholder replaced and special password characters URL-encoded.';
  }
  if (error instanceof MigrationHistoryError)
    return '[migration_history] The database migration history differs from this build. Preserve the database and check the deployed branch; do not delete tables.';
  if (typeof error !== 'object' || error === null)
    return '[unknown] Check database connectivity and migration history.';
  const value = error as { code?: unknown; message?: unknown; cause?: unknown };
  switch (value.code) {
    case '28P01':
    case '28000':
      return '[authentication] Check the database username and password in DATABASE_URL. Use the full Session pooler username from Supabase Connect.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return '[dns] The database hostname could not be resolved. Copy the Session pooler address again from Supabase Connect.';
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
      return '[network] The database address is unreachable. Use the IPv4-compatible Session pooler on port 5432.';
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'ECONNRESET':
    case '57P03':
      return '[connection] The database connection failed. Check that the Supabase project is active, port 5432 is selected, and network restrictions allow Render.';
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'CERT_HAS_EXPIRED':
      return '[tls] Database certificate verification failed. Check the Session pooler hostname and DATABASE_SSL_CA certificate; keep DATABASE_SSL=true.';
    case '42501':
      return '[permissions] The database user cannot apply migrations. Use the PostgreSQL connection credentials from Supabase Connect, not a Supabase API key.';
    case '3D000':
      return '[database_name] The selected database does not exist. Copy the database name from Supabase Connect.';
    case '42P07':
    case '42710':
      return '[existing_objects] Database objects already exist outside the expected migration history. Preserve the database and inspect its history before retrying.';
  }
  // Match known provider text internally but never print any part of it.
  if (typeof value.message === 'string') {
    if (value.message.includes('Tenant or user not found'))
      return '[pooler_user] Supabase could not find this pooler user. Copy the full Session pooler username, including the project reference.';
    if (
      value.message.includes('connection timeout') ||
      value.message === 'timeout exceeded when trying to connect'
    )
      return '[timeout] Database connection timed out. Check that Supabase is active and use the Session pooler on port 5432.';
  }
  return '[unknown] Check database connectivity and migration history.';
}
