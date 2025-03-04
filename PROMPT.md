# Permafrost AI Implementation Guide

## Project Metadata
- **Name**: Permafrost
- **Type**: Self-hosted relay and co-signature service provider
- **Main Language**: TypeScript
- **Runtime Environment**: Node.js with Bun
- **Key Dependencies**: Express, WebSockets, Lightning Network integration

## Core Features
1. 🔐 NIP-07 authentication
2. ⚡ Lightning invoice payments
3. 🔒 Permissioned relay
4. 🌉 Bifrost node management
5. 👤 Account management
6. 🛡️ Encryption at rest

## Architecture Overview

```
src/
├── api/            # API routes
│   ├── auth.ts     # Authentication routes
│   ├── account.ts  # Account and Bifrost node management
│   ├── payment.ts  # Payment processing
│   └── bifrost.ts  # Bifrost node management
├── services/       # Business logic
│   ├── auth.ts     # Authentication service
│   ├── account.ts  # Account management
│   ├── payment.ts  # Lightning payment processing
│   ├── relay.ts    # Enhanced relay with permissions
│   └── bifrost.ts  # Bifrost node management
├── db/             # Database models and access
├── lib/            # Shared utilities
├── config/         # Configuration management
├── types/          # TypeScript types and interfaces
├── middleware/     # Express/HTTP middleware
└── server.ts       # Main server entry point
```

## Database Schema

### Users
```typescript
interface User {
  id: string;         // Primary key
  pubkey: string;     // From NIP-07
  created_at: number; // Unix timestamp
  last_login: number; // Unix timestamp
}
```

### Accounts
```typescript
interface Account {
  id: string;         // Primary key
  user_id: string;    // Foreign key to Users
  status: 'active' | 'inactive' | 'suspended';
  created_at: number; // Unix timestamp
  expires_at: number; // Unix timestamp
}
```

### Payments
```typescript
interface Payment {
  id: string;         // Primary key
  account_id: string; // Foreign key to Accounts
  invoice: string;    // Lightning invoice
  amount: number;     // Payment amount in sats
  status: 'pending' | 'paid' | 'expired';
  created_at: number; // Unix timestamp
  paid_at?: number;   // Unix timestamp, optional
}
```

### BifrostNodes
```typescript
interface BifrostNode {
  id: string;         // Primary key
  account_id: string; // Foreign key to Accounts
  encrypted_credentials: string;
  status: 'active' | 'inactive' | 'error';
  created_at: number; // Unix timestamp
}
```

## Implementation Plan

### Phase 1: Foundation & Refactoring

#### Task 1.1: Set up project structure
```bash
# Execute these commands to create the initial structure
mkdir -p src/{api,services,db,lib,config,types,middleware}
touch src/server.ts
```

#### Task 1.2: Create TypeScript configurations
```typescript
// Create tsconfig.json for TypeScript configuration
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### Task 1.3: Define core types
Generate TypeScript interfaces for all core entities:

```typescript
// src/types/index.ts - Create comprehensive type definitions for all entities
export interface User {
  id: string;
  pubkey: string;
  created_at: number;
  last_login: number;
}

export interface Account {
  id: string;
  user_id: string;
  status: 'active' | 'inactive' | 'suspended';
  created_at: number;
  expires_at: number;
}

export interface Payment {
  id: string;
  account_id: string;
  invoice: string;
  amount: number;
  status: 'pending' | 'paid' | 'expired';
  created_at: number;
  paid_at?: number;
}

export interface BifrostNode {
  id: string;
  account_id: string;
  encrypted_credentials: string;
  status: 'active' | 'inactive' | 'error';
  created_at: number;
}

// Add necessary type definitions for authentication, relay, etc.
```

#### Task 1.4: Configuration Management
Create a robust configuration management system:

```typescript
// src/config/index.ts - Configuration management with environment variables
import { z } from 'zod';
import * as dotenv from 'dotenv';
dotenv.config();

// Define configuration schema with validation
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8002),
  HOST: z.string().default('localhost'),
  
  // Database
  DB_URL: z.string(),
  
  // Lightning
  LIGHTNING_NODE_URL: z.string(),
  LIGHTNING_MACAROON: z.string(),
  
  // Encryption
  ENCRYPTION_KEY: z.string(),
  
  // Relay
  RELAY_INFO: z.object({
    name: z.string().default('Permafrost Relay'),
    description: z.string().default('A permissioned Nostr relay'),
    pubkey: z.string().optional(),
    contact: z.string().optional(),
  }).default({}),
});

// Parse and export configuration
export const config = configSchema.parse(process.env);
```

### Phase 2: Core Features Implementation

#### Task 2.1: NIP-07 Authentication

```typescript
// src/services/auth.ts - Authentication service implementation

export interface AuthChallenge {
  challenge: string;
  created_at: number;
  expires_at: number;
}

/**
 * Generates a challenge for NIP-07 login
 * @returns Authentication challenge object
 */
export function generateChallenge(): AuthChallenge {
  // Implementation details...
}

/**
 * Verifies a signed challenge from a Nostr extension
 * @param signedEvent The signed event from NIP-07 extension
 * @param challenge The original challenge
 * @returns Boolean indicating if verification was successful
 */
export function verifySignedChallenge(signedEvent: any, challenge: AuthChallenge): boolean {
  // Implementation details...
}

// Implementation for session management, etc.
```

#### Task 2.2: Lightning Payment Processing

```typescript
// src/services/payment.ts - Lightning payment service

export interface InvoiceRequest {
  amount: number;
  description: string;
  accountId: string;
}

export interface Invoice {
  id: string;
  bolt11: string;
  amount: number;
  description: string;
  expires_at: number;
  status: 'pending' | 'paid' | 'expired';
}

/**
 * Creates a new Lightning invoice
 * @param request Invoice creation request
 * @returns Created invoice
 */
export async function createInvoice(request: InvoiceRequest): Promise<Invoice> {
  // Implementation details...
}

/**
 * Checks payment status for an invoice
 * @param invoiceId The ID of the invoice to check
 * @returns Updated invoice with current status
 */
export async function checkPaymentStatus(invoiceId: string): Promise<Invoice> {
  // Implementation details...
}

// Additional payment-related functions
```

#### Task 2.3: Permissioned Relay Implementation

```typescript
// src/services/relay.ts - Enhanced relay with permissions

export interface RelayPermissions {
  canRead: boolean;
  canWrite: boolean;
  allowedEventKinds?: number[];
  expiresAt?: number;
}

/**
 * Checks if a user has permission to perform an action on the relay
 * @param pubkey The user's public key
 * @param action The action being attempted (read/write)
 * @param eventKind Optional event kind for write actions
 * @returns Boolean indicating if the action is permitted
 */
export async function checkPermission(
  pubkey: string, 
  action: 'read' | 'write',
  eventKind?: number
): Promise<boolean> {
  // Implementation details...
}

// Additional relay permission functions
```

### Phase 3: Integration & UI Development

#### Task 3.1: API Routes Implementation

```typescript
// src/api/auth.ts - Authentication routes

import express from 'express';
import * as AuthService from '../services/auth';

const router = express.Router();

/**
 * Route to request a login challenge
 * GET /api/auth/challenge
 */
router.get('/challenge', (req, res) => {
  // Implementation details...
});

/**
 * Route to verify a signed challenge
 * POST /api/auth/verify
 */
router.post('/verify', (req, res) => {
  // Implementation details...
});

export default router;
```

#### Task 3.2: Frontend Components

```typescript
// src/frontend/components/Login.tsx - Example React component

import React, { useState } from 'react';

export function Login() {
  const [isLoading, setIsLoading] = useState(false);
  
  const handleLogin = async () => {
    // Implementation of NIP-07 login flow...
  };
  
  return (
    <div className="login-container">
      <h2>Login with Nostr</h2>
      <button 
        onClick={handleLogin} 
        disabled={isLoading}
      >
        {isLoading ? 'Connecting...' : 'Connect with Nostr Extension'}
      </button>
    </div>
  );
}
```

## AI Implementation Guide

### General AI Usage Instructions

When implementing Permafrost using AI assistance, follow these guidelines:

1. **Request specific components**: Ask for one component at a time with detailed requirements
2. **Provide clear context**: Include information about how the component will interact with other parts of the system
3. **Review generated code**: Validate AI-generated code against the architecture and requirements
4. **Ask for explanations**: Request detailed explanations for complex implementations
5. **Incremental development**: Build the system incrementally, testing each component as you go

### Example AI Prompts

#### Type Definitions Prompt

```
Generate TypeScript interfaces for the core entities in our Permafrost system:
1. User (with NIP-07 authentication properties)
2. Account (for service subscription management)
3. Payment (for Lightning invoice processing)
4. BifrostNode (for node management)

Include all necessary properties based on the database schema, with appropriate TypeScript types and comments.
```

#### Authentication Service Prompt

```
Create a NIP-07 authentication service with the following features:
1. Challenge generation for secure login
2. Signature verification of challenges
3. Session management
4. User lookup and creation

The service should use the User interface we defined earlier and handle all error cases properly. 
Include TypeScript type definitions for all functions and parameters.
```

#### Lightning Payment Prompt

```
Implement a Lightning payment service that:
1. Generates bolt11 invoices
2. Tracks payment status
3. Updates account status when payment is confirmed
4. Handles webhook notifications from a Lightning node

The implementation should be compatible with LND and use proper error handling and logging.
```

## Testing Guidelines

For each component, implement tests that cover:

1. **Unit tests**: Test individual functions and methods
2. **Integration tests**: Test interaction between components
3. **API tests**: Test HTTP endpoints
4. **Authentication tests**: Verify the security of the authentication system
5. **Payment flow tests**: Validate the entire payment process

Example test structure:

```typescript
// src/tests/auth.test.ts

import { generateChallenge, verifySignedChallenge } from '../services/auth';

describe('Authentication Service', () => {
  test('should generate a valid challenge', () => {
    const challenge = generateChallenge();
    expect(challenge).toHaveProperty('challenge');
    expect(challenge).toHaveProperty('created_at');
    expect(challenge).toHaveProperty('expires_at');
  });
  
  test('should verify a correctly signed challenge', () => {
    // Test implementation...
  });
  
  test('should reject an invalid signature', () => {
    // Test implementation...
  });
});
```

## Deployment Guidelines

1. **Environment Setup**:
   - Node.js >= 16
   - PostgreSQL database
   - Lightning node (LND or similar)
   - Secure key management

2. **Configuration**:
   - Use environment variables for all configuration
   - Secure the encryption keys and API credentials
   - Set up proper SSL/TLS for production

3. **Monitoring**:
   - Implement health checks
   - Set up logging
   - Monitor payment status and relay performance

## Security Considerations

1. **Encryption**:
   - All sensitive data must be encrypted at rest
   - Use account-specific salts for additional security
   - Implement proper key rotation procedures

2. **Authentication**:
   - Validate all NIP-07 signatures properly
   - Implement session timeouts
   - Use HTTPS for all API requests

3. **Payment Security**:
   - Verify Lightning payments through secure channels
   - Implement idempotent payment processing
   - Handle payment failures gracefully

---

By following this implementation guide, you can build the Permafrost system in a structured, secure, and maintainable way. The AI-friendly format of this document should help you leverage AI assistance effectively throughout the development process.

