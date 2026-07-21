// Test setup file - must be imported before any NestJS/Vendure modules
import 'reflect-metadata';

// Ensure Reflect API is available globally
console.log('Reflect.defineMetadata available:', typeof Reflect.defineMetadata);
