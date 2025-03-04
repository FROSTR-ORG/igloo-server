# Permafrost

Rent-a-signer service.

## Features:

- Login using NIP-07.
- Generate a lightning invoice to pay for the service.
- Offers a permissioned relay for the user.
- Mange and run a bifrost node.
- Each node connects to the relay directly (through localhost).

## Overview

Permafrost is a self-hosted relay and co-signature service provider. It is designed to be used by multiple users, whom authenticate with NIP-07 for authentication and account management. Users can create an account via NIP-07 login, pay for the service via a lightning invoice, and manage their account via the web interface.

When a user pays for an account, they are given a bifrost node. This node is run by the permafrost server, and is used to co-sign transactions for the user.

The bifrost node is configured to connect to the permafrost relay. The user's other shares are also given permission to connect to the relay.

## Ephemeral Relay

The permafrost relay is a simple, permissioned, ephemeral relay that is used to assist in peering between bifrost nodes.

## Co-Signer

Provides each account with a dedicated bifrost node, pre-configured to connect to the permafrost relay.

## Account Management

Each user can login via NIP-07 to manage their account and configure their bifrost node.

## Encrypted at Rest

All stored keys are encrypted at rest using the server's internal encryption key, plus an account-specific salt.

## Lightning Payments

Accounts are purchased via a bolt11 lightning invoice. An anonymous account is created when the invoice is paid.

## Admin Dashboard

The admin dashboard is used to access server-wide settings and metrics. The admin can view the status of the relay, and change the server between private, permissioned, and paid modes.
