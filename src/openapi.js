export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'SuperOffer Authentication API',
    version: '1.0.0',
    description: 'Registration and login API for the first SuperOffer backend slice.'
  },
  servers: [
    {
      url: 'http://127.0.0.1:3000',
      description: 'Local development'
    }
  ],
  tags: [
    { name: 'Health', description: 'Service availability' },
    { name: 'Authentication', description: 'Account registration and login' }
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Check service health',
        operationId: 'getHealth',
        responses: {
          200: {
            description: 'Backend is available',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' }
              }
            }
          }
        }
      }
    },
    '/api/v1/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register an account',
        operationId: 'registerUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterRequest' },
              examples: {
                universityOfficer: {
                  summary: 'University officer',
                  value: {
                    email: 'maya.chen@northbridge.edu',
                    password: 'password123',
                    role: 'UNIVERSITY_OFFICER'
                  }
                }
              }
            }
          }
        },
        responses: {
          201: {
            description: 'Account created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RegisterResponse' }
              }
            }
          },
          400: {
            description: 'Invalid email, password, or role',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          409: {
            description: 'Email is already registered',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Log in with email and password',
        operationId: 'loginUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
              examples: {
                universityOfficer: {
                  value: {
                    identifier: 'maya.chen@northbridge.edu',
                    password: 'password123'
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginResponse' }
              }
            }
          },
          400: {
            description: 'Email or password is missing',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          401: {
            description: 'Invalid credentials',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          423: {
            description: 'Account temporarily locked',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LockedResponse' }
              }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      HealthResponse: {
        type: 'object',
        required: ['status', 'service', 'timestamp'],
        properties: {
          status: { type: 'string', examples: ['ok'] },
          service: { type: 'string', examples: ['superoffer-auth'] },
          timestamp: { type: 'string', format: 'date-time' }
        }
      },
      RegisterRequest: {
        type: 'object',
        required: ['email', 'password', 'role'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: {
            type: 'string',
            format: 'password',
            minLength: 8,
            pattern: '^(?=.*[A-Za-z])(?=.*\\d).{8,}$',
            description: 'At least eight characters with one letter and one number.'
          },
          role: {
            type: 'string',
            enum: ['STUDENT', 'UNIVERSITY_OFFICER', 'LOAN_OFFICER', 'CONSULTANT']
          }
        }
      },
      RegisterResponse: {
        type: 'object',
        required: ['user_id', 'otp_required'],
        properties: {
          user_id: { type: 'string', format: 'uuid' },
          otp_required: { type: 'boolean', examples: [true] }
        }
      },
      LoginRequest: {
        type: 'object',
        required: ['identifier', 'password'],
        properties: {
          identifier: {
            type: 'string',
            description: 'Registered email address.',
            examples: ['maya.chen@northbridge.edu']
          },
          password: { type: 'string', format: 'password' }
        }
      },
      LoginResponse: {
        type: 'object',
        required: [
          'access_token',
          'refresh_token',
          'expires_in',
          'role',
          'mfa_required',
          'email_verified'
        ],
        properties: {
          access_token: { type: 'string', description: 'HS256 JWT access token.' },
          refresh_token: { type: 'string', description: 'HS256 JWT refresh token.' },
          expires_in: { type: 'integer', examples: [3600] },
          role: {
            type: 'string',
            enum: ['STUDENT', 'UNIVERSITY_OFFICER', 'LOAN_OFFICER', 'CONSULTANT']
          },
          mfa_required: { type: 'boolean', examples: [false] },
          email_verified: { type: 'boolean', examples: [false] }
        }
      },
      ErrorResponse: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' }
        }
      },
      LockedResponse: {
        allOf: [
          { $ref: '#/components/schemas/ErrorResponse' },
          {
            type: 'object',
            required: ['retry_after_seconds'],
            properties: {
              retry_after_seconds: { type: 'integer', minimum: 1 }
            }
          }
        ]
      }
    }
  }
};
