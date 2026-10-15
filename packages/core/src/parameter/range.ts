import type {
  BooleanParameter,
  EnumParameter,
  NumberParameter,
  Parameter,
  StringParameter,
} from '@tensnap/protocol';

const MIN_POWER_MAGNITUDE = 1e-10;
const DEFAULT_RANGE_DIVISIONS = 100;

export interface RangeHint {
  value: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface EstimatedRange {
  min: number;
  max: number;
  step: number;
}

/**
 * Fill missing UI constraints while preserving valid simulator-provided bounds
 * and increments. Non-finite current values cannot produce a usable range.
 */
export function estimateNumericRange(hint: RangeHint): EstimatedRange {
  const { value, min, max, step } = hint;
  if (!Number.isFinite(value)) throw new RangeError('Parameter value must be finite.');

  const isIntegerValue = Number.isInteger(value) && value !== 0;
  const isIntegerMin = min == undefined || Number.isInteger(min);
  const isIntegerMax = max == undefined || Number.isInteger(max);
  const isIntegerStep = step == undefined || Number.isInteger(step);
  const shouldUseInteger = isIntegerValue && isIntegerMin && isIntegerMax && isIntegerStep;

  function toPowerOfTen(val: number, roundUp: boolean = false): number {
    if (val === 0) return 0;

    const absVal = Math.abs(val);
    const sign = val < 0 ? -1 : 1;

    // Clamp tiny nonzero magnitudes to a signed unit.
    if (absVal < MIN_POWER_MAGNITUDE) return val < 0 ? -1 : val === 0 ? 0 : 1;

    const log10Val = Math.log10(absVal);
    const exponent = roundUp ? Math.ceil(log10Val) : Math.floor(log10Val);

    const result = sign * Math.min(Number.MAX_VALUE, Math.pow(10, exponent));

    // Keep inferred bounds integral when all supplied constraints are integral.
    if (shouldUseInteger && Math.abs(result) < 1) {
      return sign;
    }

    return result;
  }

  function isValidHint(min?: number, max?: number, value?: number): boolean {
    if (
      (min !== undefined && !Number.isFinite(min)) ||
      (max !== undefined && !Number.isFinite(max))
    )
      return false;
    if (min !== undefined && max !== undefined && min >= max) return false;
    if (value !== undefined) {
      if (min !== undefined && value < min) return false;
      if (max !== undefined && value > max) return false;
    }
    return true;
  }

  const validBounds = isValidHint(min, max, value);
  const validMin = validBounds ? min : undefined;
  const validMax = validBounds ? max : undefined;
  const validStep = step !== undefined && Number.isFinite(step) && step > 0 ? step : undefined;

  // Explicit constraints are simulator-owned, not candidates for rounding.
  if (validMin !== undefined && validMax !== undefined && validStep !== undefined) {
    return {
      min: validMin,
      max: validMax,
      step: validStep,
    };
  }

  const absVal = Math.abs(value);
  const isZero = absVal < Number.EPSILON;
  const isNegative = value < 0;

  let estimatedMin: number;
  let estimatedMax: number;

  if (validMin !== undefined && validMax !== undefined) {
    estimatedMin = validMin;
    estimatedMax = validMax;
  } else if (validMin !== undefined) {
    estimatedMin = validMin;
    if (isZero) {
      estimatedMax = toPowerOfTen(validMin + 10);
    } else {
      const range = Math.abs(value - validMin) * 10;
      estimatedMax = toPowerOfTen(Math.max(value, validMin) + range, true);
    }
  } else if (validMax !== undefined) {
    estimatedMax = validMax;
    if (isZero) {
      estimatedMin = toPowerOfTen(validMax - 10);
    } else {
      const range = Math.abs(validMax - value) * 10;
      estimatedMin = toPowerOfTen(Math.min(value, validMax) - range);
    }
  } else {
    // Infer both bounds from the current value when neither is supplied.
    if (isZero) {
      estimatedMin = -1;
      estimatedMax = 1;
    } else if (isNegative) {
      // Extend negative values in both directions.
      const magnitude = toPowerOfTen(absVal, true);
      estimatedMin = -magnitude * 10;
      estimatedMax = magnitude;
    } else {
      const magnitude = toPowerOfTen(value, true);
      estimatedMin = toPowerOfTen(value / DEFAULT_RANGE_DIVISIONS);
      estimatedMax = magnitude * 10;
    }
  }

  // Clamp overflow from expanding finite extrema and retain the current value.
  estimatedMin = Math.max(-Number.MAX_VALUE, Math.min(estimatedMin, value));
  estimatedMax = Math.min(Number.MAX_VALUE, Math.max(estimatedMax, value));

  if (estimatedMin >= estimatedMax) {
    if (isZero) {
      estimatedMin = -1;
      estimatedMax = 1;
    } else {
      const center = estimatedMin / 2 + estimatedMax / 2;
      const magnitude = Math.max(Math.abs(estimatedMin), Math.abs(estimatedMax));
      const powerMagnitude = toPowerOfTen(magnitude, true);
      estimatedMin = Math.max(-Number.MAX_VALUE, center - powerMagnitude);
      estimatedMax = Math.min(Number.MAX_VALUE, center + powerMagnitude);
    }
  }

  if (validStep !== undefined) return { min: estimatedMin, max: estimatedMax, step: validStep };

  // Divide before subtracting so opposite finite extrema do not overflow.
  const targetStep =
    estimatedMax / DEFAULT_RANGE_DIVISIONS - estimatedMin / DEFAULT_RANGE_DIVISIONS;
  let estimatedStep =
    targetStep === 0
      ? isZero
        ? 0.1
        : toPowerOfTen(Math.abs(value) / DEFAULT_RANGE_DIVISIONS)
      : toPowerOfTen(targetStep);
  if (shouldUseInteger && estimatedStep < 1) estimatedStep = 1;

  // Keep the inferred step no larger than the magnitude of a nonzero lower bound.
  if (estimatedMin !== 0 && Math.abs(estimatedMin) < estimatedStep) {
    estimatedStep = toPowerOfTen(Math.abs(estimatedMin));
  }

  // Keep the inferred step small enough to move within the range.
  const range = estimatedMax - estimatedMin;
  if (estimatedStep > range / 2) {
    estimatedStep = toPowerOfTen(targetStep);
  }

  return {
    min: estimatedMin,
    max: estimatedMax,
    step: estimatedStep,
  };
}

export function sanitizeParameter(param: Parameter, inPlace: boolean = false): Parameter {
  const result = inPlace ? param : { ...param };

  switch (param.type) {
    case 'number': {
      const estimatedRange = estimateNumericRange({
        value: param.value,
        min: param.min,
        max: param.max,
        step: param.step,
      });

      (result as NumberParameter).min = estimatedRange.min;
      (result as NumberParameter).max = estimatedRange.max;
      (result as NumberParameter).step = estimatedRange.step;
      break;
    }

    case 'enum': {
      if (!param.options?.includes(param.value)) {
        (result as EnumParameter).value = param.options?.[0] ?? '';
      }
      break;
    }

    case 'boolean': {
      const value = (param as BooleanParameter).value;
      if (typeof value !== 'boolean') {
        (result as BooleanParameter).value =
          value === 'false' || value === 'False' ? false : Boolean(value);
      }
      break;
    }

    case 'string': {
      const value = (param as StringParameter).value;
      if (typeof value !== 'string') {
        (result as StringParameter).value = value == null ? '' : String(value);
      }
      break;
    }
  }

  return result;
}
