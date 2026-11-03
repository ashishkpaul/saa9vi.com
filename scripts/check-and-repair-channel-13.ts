#!/usr/bin/env ts-node
/**
 * Script to check and repair Channel 13 role assignments.
 * 
 * Channel 13 (`test-academy-f9hmus`) has its tenant administrator role
 * but is missing from the built-in SuperAdmin and Customer role channel assignments.
 * 
 * This script:
 * 1. Checks the current status of channel 13 role assignments
 * 2. Repairs the missing assignments if needed
 * 3. Uses the new GraphQL API mutations (not direct database access)
 */

import 'reflect-metadata';
import 'dotenv/config';
import { bootstrap } from '@vendure/core';
import { config } from '../src/vendure-config';
import { gql } from 'graphql-tag';

const CHANNEL_13_ID = '13'; // Channel ID for test-academy-f9hmus

// GraphQL queries and mutations
const CHECK_CHANNEL_ROLE_ASSIGNMENTS = gql`
  query CheckChannelRoleAssignments($channelId: ID!) {
    checkChannelRoleAssignments(channelId: $channelId) {
      channelId
      channelCode
      channelToken
      superAdminRoleAssigned
      customerRoleAssigned
      errors
    }
  }
`;

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
  console.log('=== Channel 13 Role Assignment Check & Repair ===\n');
  
  // Bootstrap the application
  console.log('Booting Vendure application...');
  const app = await bootstrap(config);
  
  try {
    // Get the GraphQL Apollo Server
    const apolloServer = app.getHttpAdapter().getInstance();
    
    // First, we need to login as SuperAdmin
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
    
    console.log('✓ Logged in as SuperAdmin\n');
    
    // Check current status
    console.log(`Checking role assignments for channel ${CHANNEL_13_ID}...`);
    const checkResult = await apolloServer.executeOperation({
      query: CHECK_CHANNEL_ROLE_ASSIGNMENTS,
      variables: {
        channelId: CHANNEL_13_ID,
      },
    });
    
    if (checkResult.errors) {
      console.error('Failed to check channel role assignments:', checkResult.errors);
      process.exit(1);
    }
    
    const checkData = checkResult.data?.checkChannelRoleAssignments;
    console.log('Current Status:');
    console.log(`  Channel: ${checkData.channelCode} (ID: ${checkData.channelId}, Token: ${checkData.channelToken})`);
    console.log(`  SuperAdmin Role Assigned: ${checkData.superAdminRoleAssigned ? '✓ YES' : '✗ NO'}`);
    console.log(`  Customer Role Assigned: ${checkData.customerRoleAssigned ? '✓ YES' : '✗ NO'}`);
    
    if (checkData.errors.length > 0) {
      console.log('  Errors:');
      checkData.errors.forEach((error: string) => console.log(`    - ${error}`));
    }
    
    // Check if repair is needed
    const needsRepair = !checkData.superAdminRoleAssigned || !checkData.customerRoleAssigned;
    
    if (!needsRepair) {
      console.log('\n✓ Channel 13 role assignments are correct. No repair needed.');
      process.exit(0);
    }
    
    console.log('\n✗ Channel 13 needs role assignment repair.');
    
    // Ask for confirmation
    console.log('\nDo you want to repair the role assignments? (yes/no)');
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    rl.question('> ', async (answer: string) => {
      rl.close();
      
      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        console.log('Repair cancelled.');
        process.exit(0);
      }
      
      // Perform repair
      console.log('\nRepairing channel role assignments...');
      const repairResult = await apolloServer.executeOperation({
        query: REPAIR_CHANNEL_ROLE_ASSIGNMENTS,
        variables: {
          channelId: CHANNEL_13_ID,
        },
      });
      
      if (repairResult.errors) {
        console.error('Failed to repair channel role assignments:', repairResult.errors);
        process.exit(1);
      }
      
      const repairData = repairResult.data?.repairChannelRoleAssignments;
      console.log('Repair Result:');
      console.log(`  SuperAdmin Role Assigned: ${repairData.superAdminRoleAssigned ? '✓ SUCCESS' : '✗ FAILED'}`);
      console.log(`  Customer Role Assigned: ${repairData.customerRoleAssigned ? '✓ SUCCESS' : '✗ FAILED'}`);
      
      if (repairData.errors.length > 0) {
        console.log('  Errors during repair:');
        repairData.errors.forEach((error: string) => console.log(`    - ${error}`));
      }
      
      // Verify repair
      console.log('\nVerifying repair...');
      const verifyResult = await apolloServer.executeOperation({
        query: CHECK_CHANNEL_ROLE_ASSIGNMENTS,
        variables: {
          channelId: CHANNEL_13_ID,
        },
      });
      
      if (verifyResult.errors) {
        console.error('Failed to verify repair:', verifyResult.errors);
        process.exit(1);
      }
      
      const verifyData = verifyResult.data?.checkChannelRoleAssignments;
      const repairSuccessful = verifyData.superAdminRoleAssigned && verifyData.customerRoleAssigned;
      
      if (repairSuccessful) {
        console.log('✓ Channel 13 role assignments successfully repaired!');
        console.log(`  SuperAdmin can now see channel ${verifyData.channelCode} in dashboard switcher`);
        console.log(`  Customers can now authenticate against channel ${verifyData.channelCode}`);
      } else {
        console.log('✗ Repair failed or incomplete.');
        if (verifyData.errors.length > 0) {
          verifyData.errors.forEach((error: string) => console.log(`  - ${error}`));
        }
        process.exit(1);
      }
      
      await app.close();
      process.exit(0);
    });
    
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
