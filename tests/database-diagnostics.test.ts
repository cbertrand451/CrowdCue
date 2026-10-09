import { describe, expect, it } from 'vitest';
import { rootCertificates } from 'node:tls';
import { databaseOptions } from '../src/server/db/index.js';
import {
  databaseFailure,
  DatabaseConfigurationError,
  MigrationHistoryError,
} from '../src/server/db/diagnostics.js';

describe('safe deployment database diagnostics', () => {
  it('classifies failures without printing provider messages or connection details', () => {
    for (const [code, category] of [
      ['28P01', 'authentication'],
      ['ENOTFOUND', 'dns'],
      ['ENETUNREACH', 'network'],
      ['ECONNREFUSED', 'connection'],
      ['SELF_SIGNED_CERT_IN_CHAIN', 'tls'],
      ['42501', 'permissions'],
      ['3D000', 'database_name'],
      ['42P07', 'existing_objects'],
      ['secret-code', 'unknown'],
    ]) {
      const message = databaseFailure({
        code,
        message: 'postgresql://private-user:private-password@private-host/db',
        detail: 'private-token',
      });
      expect(message).toContain(`[${category}]`);
      expect(message).not.toMatch(/private-|secret-code/);
    }
    expect(
      databaseFailure({ message: 'Tenant or user not found: private-user' }),
    ).toContain('[pooler_user]');
    expect(
      databaseFailure(
        new Error('Connection terminated due to connection timeout'),
      ),
    ).toContain('[timeout]');
    expect(databaseFailure(new MigrationHistoryError())).toContain(
      '[migration_history]',
    );
    expect(
      databaseFailure(new DatabaseConfigurationError('DATABASE_SSL_CA')),
    ).toContain('[certificate_format]');
    expect(databaseFailure('private-password')).toContain('[unknown]');
  });

  it('retains public trust roots and verifies certificates with either PEM newline format', () => {
    const certificate = rootCertificates[0];
    const url = 'postgresql://test:test@database.example/postgres';
    for (const ca of [certificate, certificate.replaceAll('\n', '\\n')]) {
      expect(
        databaseOptions(url, { DATABASE_SSL: 'true', DATABASE_SSL_CA: ca }).ssl,
      ).toEqual({
        rejectUnauthorized: true,
        ca: [...rootCertificates, certificate.trim()],
      });
    }
    expect(() =>
      databaseOptions(url, { DATABASE_SSL_CA: 'certificate-file.crt' }),
    ).toThrow('DATABASE_SSL_CA');
  });
});
