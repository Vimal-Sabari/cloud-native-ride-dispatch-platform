import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.terraform/**',
      'infra/**',
      'services/location-service/**',
      'services/matching-service/**',
      'shared/geospatial/**',
      'shared/matching-algorithms/**',
      'shared/models/go/**',
      'shared/dynamo-client/go/**',
      'tests/integration/**'
    ]
  }
);
