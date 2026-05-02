import { z } from 'zod';
import { 
  SimulatorToRendererMessageSchema,
  RendererToSimulatorMessageSchema,
  getPayloadSchema 
} from '@tensnap/core';

export type ValidationLevel = 'off' | 'warning' | 'error';
export type MessageDirection = 'client-to-server' | 'server-to-client';

export interface ValidationResult {
  valid: boolean;
  errors?: z.ZodError;
  message?: string;
}

/**
 * Validates a WebSocket message based on its direction and validation level
 */
export function validateMessage(
  message: any,
  direction: MessageDirection,
  level: ValidationLevel
): ValidationResult {
  // Skip validation if level is 'off'
  if (level === 'off') {
    return { valid: true };
  }

  try {
    // Validate the message structure
    const messageSchema = direction === 'client-to-server'
      ? RendererToSimulatorMessageSchema
      : SimulatorToRendererMessageSchema;
    
    const parsedMessage = messageSchema.parse(message);
    
    // Validate the payload based on message type
    const payloadSchema = getPayloadSchema(parsedMessage.type);
    payloadSchema.parse(parsedMessage.payload);
    
    return { valid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = `Message validation failed: ${error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
      
      // Handle based on validation level
      if (level === 'warning') {
        console.warn(`[WebSocket Validation Warning] ${errorMessage}`, {
          message,
          errors: error.issues,
        });
        return { valid: true, errors: error, message: errorMessage };
      } else if (level === 'error') {
        console.error(`[WebSocket Validation Error] ${errorMessage}`, {
          message,
          errors: error.issues,
        });
        return { valid: false, errors: error, message: errorMessage };
      }
    }
    
    return { valid: false, message: 'Unknown validation error' };
  }
}

/**
 * Validates a client-to-server message
 */
export function validateClientMessage(message: any, level: ValidationLevel): ValidationResult {
  return validateMessage(message, 'client-to-server', level);
}

/**
 * Validates a server-to-client message
 */
export function validateServerMessage(message: any, level: ValidationLevel): ValidationResult {
  return validateMessage(message, 'server-to-client', level);
}
