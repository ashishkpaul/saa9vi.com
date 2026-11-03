#!/usr/bin/env ts-node
/**
 * Simple script to repair Channel 13 role assignments.
 * Run with: npx ts-node scripts/repair-channel-13.ts
 */

import 'reflect-metadata';
import 'dotenv/config';
import { bootstrap } from '@vendure/core';
import { config } from '../src/vendure-config';
import { gql } from 'graphql-tag';

const CHANNEL_13_ID = '13'; // Channel ID for test-academy-f9hmus

const REPAIR_CHANNEL_ROLE_ASSIGNMENTS = gql`
  mutation RepairChannelRoleAssignments($channelId: ID!) {
    repairChannelRoleAssignments(channelId: $channelId) {
      channelId
      channelCode
      channelToken
      superAdminRoleAssigned
      customerRoleAssigned
      errors
    }
  }
`;

const LOGIN_MUTATION = gql`
  mutation Login($username: String!, $password: String!) {
    login(username: $username, password: $password) {
      ... on CurrentUser {
        id
        identifier
        channels {
          id
          code
          token
          permissions
        }
      }
    }
  }
`;

async function main() {
  console.log('Repairing Channel 13 role assignments...\n');
  
  const app = await bootstrap(config);
  
  try {
    const apolloServer = app.getHttpAdapter().getInstance();
    
    // Login as SuperAdmin
    console.log('Logging in as SuperAdmin...');
    const loginResult = await apolloServer.executeOperation({
      query: LOGIN_MUTATION,
      variables: {
        username: 'superadmin',
        password: 'superadmin',
      },
    });
    
    if (loginResult.errors || !loginResult.data?.login?.id) {
      console.error('Failed to login as SuperAdmin:', loginResult.errors);
      process.exit(1);
    }
    
    console.log('✓ Logged in\n');
    
    // Perform repair
    console.log('Repairing role assignments...');
    const repairResult = await apolloServer.executeOperation({
      query: REPAIR_CHANNEL_ROLE_ASSIGNMENTS,
      variables: {
        channelId: CHANNEL_13_ID,
      },
    });
    
    if (repairResult.errors) {
      console.error('Failed to repair:', repairResult.errors);
      process.exit(1);
    }
    
    const data = repairResult.data?.repairChannelRoleAssignments;
    
    console.log('\n=== Repair Result ===');
    console.log(`Channel: ${data.channelCode} (ID: ${data.channelId})`);
    console.log(`SuperAdmin Role: ${data.superAdminRoleAssigned ? '✅ ASSIGNED' : '❌ FAILED'}`);
    console.log(`Customer Role: ${data.customerRoleAssigned ? '✅ ASSIGNED' : '❌ FAILED'}`);
    
    if (data.errors.length > 0) {
      console.log('\nErrors:');
      data.errors.forEach((error: string) => console.log(`  - ${error}`));
    }
    
    if (data.superAdminRoleAssigned && data.customerRoleAssigned) {
      console.log('\n✅ SUCCESS: Channel 13 role assignments repaired!');
      console.log('SuperAdmin can now see this channel in the dashboard switcher.');
      console.log('Customers can now authenticate against this channel.');
    } else {
      console.log('\n❌ FAILURE: Repair incomplete.');
      process.exit(1);
    }
    
    await app.close();
    
  } catch (error) {
    console.error('Error:', error);
    await app.close();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
