// MUST be first: the production-secret guard below reads process.env, and .env
// is the only place APP_ENV / SUPERADMIN_PASSWORD / COOKIE_SECRET are set.
import 'dotenv/config';

import { bootstrapWorker } from '@vendure/core';
import { config } from './vendure-config';
import { assertProductionSecrets } from './platform/security/require-production-secrets';

// Fail fast (uncaught → non-zero exit). The worker shares the same SuperAdmin
// credentials and cookie secret, so it must not start with the dev defaults
// either. Called before the promise chain because that chain's .catch() swallows.
assertProductionSecrets();

bootstrapWorker(config)
    .then(worker => worker.startJobQueue())
    .catch(err => {
        console.log(err);
    });
