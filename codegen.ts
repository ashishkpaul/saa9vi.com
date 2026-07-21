import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
    overwrite: true,
    // To generate this schema file, run `npx vendure schema`
    // whenever your schema changes, e.g. after adding custom fields
    // or API extensions
    schema: 'schema.graphql',
    config: {
        // This tells codegen that the `Money` scalar is a number
        scalars: { Money: 'number' },
        // This ensures generated enums do not conflict with the built-in types.
        namingConvention: { enumValues: 'keep' },
    },
    generates: {
        './src/plugins/bigbluebutton-plugin/gql/generated.ts': { plugins: ['typescript'] },
        './src/plugins/cms/gql/generated.ts': { plugins: ['typescript'] },
        './src/plugins/customer-suspension/gql/generated.ts': { plugins: ['typescript'] },
        './src/plugins/load-simulation-plugin/gql/generated.ts': { plugins: ['typescript'] },
        './src/plugins/marketplace/gql/generated.ts': { plugins: ['typescript'] },
        './src/plugins/platform-dashboard/gql/generated.ts': { plugins: ['typescript'] },
        './src/plugins/reviews/gql/generated.ts': { plugins: ['typescript'] },
        './src/plugins/tenant-plugin/gql/generated.ts': { plugins: ['typescript'] },
    },
};

export default config;
