# Igloo Server API Documentation

This directory contains the comprehensive OpenAPI 3.0 specification for the Igloo Server API.

## Files

- **`openapi.yaml`** - Complete OpenAPI 3.0 specification in YAML format
- **`README.md`** - This documentation file

## Accessing the Documentation

### Interactive Documentation

When the server is running, you can access interactive API documentation at:

- **Swagger UI**: [http://localhost:8002/api/docs](http://localhost:8002/api/docs)
  - Full-featured API explorer with request testing
  - Built-in authentication support
  - Try-it-out functionality for all endpoints

### Raw Specification

- **JSON**: [http://localhost:8002/api/docs/openapi.json](http://localhost:8002/api/docs/openapi.json)
- **YAML**: [http://localhost:8002/api/docs/openapi.yaml](http://localhost:8002/api/docs/openapi.yaml)

## Using the API Documentation

### Authentication for API Documentation

- **Development**: No authentication required for easy testing
- **Production**: Authentication required for security

To authenticate in Swagger UI:
1. Use the "Authorize" button in Swagger UI
2. Enter your API key or login credentials
3. All requests will include authentication headers

### Available Authentication Methods

The API supports multiple authentication methods:

- **API Key**: Use `X-API-Key` header or `Authorization: Bearer <key>`
- **Basic Auth**: Standard HTTP Basic Authentication  
- **Session**: Cookie-based sessions for web UI

### Testing API Endpoints

1. Navigate to any endpoint in Swagger UI
2. Click "Try it out"
3. Fill in required parameters
4. Click "Execute"
5. View the response with status code, headers, and body

## API Coverage

The OpenAPI specification includes:

- ✅ All authentication endpoints (`/api/auth/*`)
- ✅ Environment management (`/api/env`)
- ✅ Server status (`/api/status`)
- ✅ Peer management (`/api/peers/*`)
- ✅ Key recovery (`/api/recover/*`)
- ✅ Share management (`/api/shares`)
- ✅ Real-time events (`/api/events`)
- ✅ Complete request/response schemas
- ✅ Authentication security schemes
- ✅ Rate limiting documentation
- ✅ Error response formats
- ✅ Comprehensive examples

## Validation

To validate the OpenAPI specification:

```bash
bun run docs:validate
```

This ensures the YAML syntax is correct and the specification is well-formed.

## Updating the Documentation

When adding or modifying API endpoints:

1. Update the corresponding section in `openapi.yaml`
2. Add/update request and response schemas
3. Include relevant examples
4. Validate the specification: `bun run docs:validate`
5. Test the updated documentation in Swagger UI

## External Tools

You can also use the OpenAPI specification with external tools:

- **Postman**: Import the JSON spec to create a Postman collection
- **Insomnia**: Import for API testing
- **Code generators**: Generate client SDKs in various languages
- **API validators**: Validate requests/responses against the spec

## Specification Standards

The OpenAPI specification follows:

- **OpenAPI 3.0.3** standard
- **RESTful API** design principles
- **Comprehensive documentation** with descriptions and examples
- **Security-first** approach with proper authentication documentation
- **Type safety** with detailed schema definitions 