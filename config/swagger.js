export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'SuperOffer Authentication API',
    version: '1.0.0',
    description: 'Registration and login API for the first SuperOffer backend slice.'
  },
  servers: [
    {
      url: 'https://api.superoffer.net',
      description: 'Production'
    },
    {
      url: 'http://127.0.0.1:3000',
      description: 'Local development'
    }
  ],
  tags: [
    { name: 'Health', description: 'Service availability' },
    { name: 'Authentication', description: 'Account registration, login, and approval status' },
    { name: 'Admin', description: 'Institution approval operations' },
    { name: 'Student portal', description: 'Authenticated student portal data' },
    { name: 'Student profile', description: 'Student onboarding, financial preferences, documents, and submission' }
  ],
  paths: {
    '/': {
      get: {
        tags: ['Health'],
        summary: 'Show API service information',
        operationId: 'getServiceInformation',
        responses: {
          200: {
            description: 'Backend service information and useful API links'
          }
        }
      }
    },
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
                    full_name: 'Maya Chen',
                    email: 'maya.chen@northbridge.edu',
                    password: 'password123',
                    role: 'UNIVERSITY_OFFICER',
                    organization: {
                      name: 'Northbridge University',
                      registration_number: 'NU-2026'
                    }
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
          403: {
            description: 'Institution account is pending approval or was rejected',
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
    },
    '/api/v1/auth/status/{userId}': {
      get: {
        tags: ['Authentication'],
        summary: 'Check an institution registration approval status',
        operationId: 'getRegistrationStatus',
        parameters: [{
          name: 'userId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        }],
        responses: {
          200: {
            description: 'Current approval status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApprovalStatusResponse' }
              }
            }
          },
          404: {
            description: 'Registration not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/v1/admin/users/{userId}/approval': {
      patch: {
        tags: ['Admin'],
        summary: 'Approve or reject an institution registration',
        operationId: 'reviewInstitutionRegistration',
        parameters: [
          {
            name: 'userId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' }
          },
          {
            name: 'x-admin-key',
            in: 'header',
            required: true,
            schema: { type: 'string' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApprovalDecisionRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Registration reviewed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApprovalStatusResponse' }
              }
            }
          },
          401: {
            description: 'Invalid admin key',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          },
          404: {
            description: 'Registration not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      }
    },
    '/api/v1/students/me': {
      get: {
        tags: ['Student portal'],
        summary: 'Get the current student profile',
        operationId: 'getCurrentStudent',
        responses: {
          200: {
            description: 'Student profile used by the student dashboard',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StudentProfile' }
              }
            }
          }
        }
      }
    },
    '/api/v1/students/me/offers': {
      get: {
        tags: ['Student portal'],
        summary: 'Get offers for the current student',
        operationId: 'getCurrentStudentOffers',
        responses: {
          200: {
            description: 'Student offer list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['results', 'total_results', 'source'],
                  properties: {
                    results: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/StudentOffer' }
                    },
                    total_results: { type: 'integer' },
                    source: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/v1/student/profile': {
      get: { tags: ['Student profile'], summary: 'Get my complete profile', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Profile, completion, and document metadata' } } },
      post: { tags: ['Student profile'], summary: 'Create my profile', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Profile created' }, 409: { description: 'Profile already exists' } } },
      patch: { tags: ['Student profile'], summary: 'Update my profile', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Profile updated' } } }
    },
    '/api/v1/student/profile/completion': {
      get: { tags: ['Student profile'], summary: 'Get profile completion status', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Section completion and readiness' } } }
    },
    '/api/v1/student/profile/financial': {
      get: { tags: ['Student profile'], summary: 'Get financial preferences', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Financial preferences' } } },
      put: { tags: ['Student profile'], summary: 'Create or update financial preferences', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Financial preferences saved' } } }
    },
    '/api/v1/student/profile/documents': {
      get: { tags: ['Student profile'], summary: 'List my documents', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Document metadata list' } } },
      post: { tags: ['Student profile'], summary: 'Upload a document', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['documentType', 'file'], properties: { documentType: { type: 'string' }, file: { type: 'string', format: 'binary' } } } } } }, responses: { 201: { description: 'Document stored in GridFS' }, 413: { description: 'File exceeds 10 MB' }, 415: { description: 'Unsupported file type' } } }
    },
    '/api/v1/student/profile/documents/{documentId}': {
      put: { tags: ['Student profile'], summary: 'Replace my document', security: [{ bearerAuth: [] }], parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Document replaced' } } },
      delete: { tags: ['Student profile'], summary: 'Delete my document', security: [{ bearerAuth: [] }], parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Document deleted' } } }
    },
    '/api/v1/student/profile/documents/{documentId}/content': {
      get: { tags: ['Student profile'], summary: 'Retrieve my document content', security: [{ bearerAuth: [] }], parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Protected document stream' }, 404: { description: 'Document not found or not owned by student' } } }
    },
    '/api/v1/student/profile/submit': {
      post: { tags: ['Student profile'], summary: 'Submit completed profile', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Profile submitted' }, 422: { description: 'Profile is incomplete' } } }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
    },
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
        required: ['full_name', 'email', 'password', 'role'],
        properties: {
          full_name: { type: 'string', minLength: 1 },
          phone: { type: 'string' },
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
          },
          organization: { $ref: '#/components/schemas/OrganizationRegistration' }
        }
      },
      OrganizationRegistration: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          registration_number: { type: 'string' },
          website: { type: 'string' },
          country: { type: 'string' },
          city: { type: 'string' },
          license_reference: { type: 'string' }
        }
      },
      RegisterResponse: {
        type: 'object',
        required: ['user_id', 'role', 'approval_status', 'can_login', 'otp_required'],
        properties: {
          user_id: { type: 'string', format: 'uuid' },
          role: { type: 'string' },
          approval_status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
          can_login: { type: 'boolean' },
          otp_required: { type: 'boolean', examples: [false] }
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
            enum: ['STUDENT', 'UNIVERSITY_OFFICER', 'LOAN_OFFICER', 'CONSULTANT', 'SUPER_ADMIN']
          },
          approval_status: { type: 'string', enum: ['APPROVED'] },
          full_name: { type: 'string' },
          organization: {
            oneOf: [
              { $ref: '#/components/schemas/OrganizationRegistration' },
              { type: 'null' }
            ]
          },
          mfa_required: { type: 'boolean', examples: [false] },
          email_verified: { type: 'boolean', examples: [false] }
        }
      },
      ApprovalDecisionRequest: {
        type: 'object',
        required: ['approval_status'],
        properties: {
          approval_status: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
          rejection_reason: { type: 'string' }
        }
      },
      ApprovalStatusResponse: {
        type: 'object',
        required: ['user_id', 'approval_status', 'can_login'],
        properties: {
          user_id: { type: 'string', format: 'uuid' },
          role: { type: 'string' },
          approval_status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
          can_login: { type: 'boolean' },
          organization_name: { type: ['string', 'null'] },
          rejection_reason: { type: ['string', 'null'] },
          submitted_at: { type: 'string', format: 'date-time' },
          reviewed_at: { type: ['string', 'null'], format: 'date-time' }
        }
      },
      StudentProfile: {
        type: 'object',
        required: ['id', 'name', 'initials', 'completion_percent', 'preferences'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          initials: { type: 'string' },
          email: { type: 'string', format: 'email' },
          location: { type: 'string' },
          program: { type: 'string' },
          education: { type: 'string' },
          gpa: { type: 'string' },
          exam: { type: 'string' },
          score: { type: 'integer' },
          skills: { type: 'array', items: { type: 'string' } },
          completion_percent: { type: 'integer', minimum: 0, maximum: 100 },
          preferences: {
            type: 'object',
            required: ['target_countries', 'target_courses', 'budget_band'],
            properties: {
              target_countries: { type: 'array', items: { type: 'string' } },
              target_courses: { type: 'array', items: { type: 'string' } },
              degree_level: { type: 'string' },
              intake_term: { type: 'string' },
              budget_band: { type: 'string' },
              scholarship_need: { type: 'boolean' }
            }
          },
          source: { type: 'string' }
        }
      },
      StudentOffer: {
        type: 'object',
        required: ['id', 'institution', 'program', 'status', 'status_label'],
        properties: {
          id: { type: 'string' },
          student_id: { type: 'integer' },
          institution: { type: 'string' },
          institution_initial: { type: 'string' },
          program: { type: 'string' },
          award: { type: 'string' },
          status: { type: 'string' },
          status_label: { type: 'string' },
          sent_at: { type: 'string', format: 'date-time' }
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
