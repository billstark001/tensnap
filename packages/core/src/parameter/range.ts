import type {
  BooleanParameter,
  EnumParameter,
  NumberParameter,
  Parameter,
  StringParameter,
} from '@tensnap/protocol';

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

export function estimateNumericRange(hint: RangeHint): EstimatedRange {
  const { value, min, max, step } = hint;

  // 检查是否所有提供的数值都是整数
  const isIntegerValue = Number.isInteger(value) && value !== 0;
  const isIntegerMin = min == undefined || Number.isInteger(min);
  const isIntegerMax = max == undefined || Number.isInteger(max);
  const isIntegerStep = step == undefined || Number.isInteger(step);
  const shouldUseInteger = isIntegerValue && isIntegerMin && isIntegerMax && isIntegerStep;

  // 辅助函数:将数值转换为10的整数次幂
  function toPowerOfTen(val: number, roundUp: boolean = false): number {
    if (val === 0) return 0;

    const absVal = Math.abs(val);
    const sign = val < 0 ? -1 : 1;

    // 防止太小的值,直接截断为0或1
    if (absVal < 1e-10) return val < 0 ? -1 : (val === 0 ? 0 : 1);

    const log10Val = Math.log10(absVal);
    const exponent = roundUp ? Math.ceil(log10Val) : Math.floor(log10Val);

    const result = sign * Math.pow(10, exponent);

    // 如果应该使用整数,确保结果至少为整数
    if (shouldUseInteger && Math.abs(result) < 1) {
      return sign;
    }

    return result;
  }

  // 检查hint是否合理
  function isValidHint(min?: number, max?: number, value?: number): boolean {
    if (min !== undefined && max !== undefined && min >= max) return false;
    if (value !== undefined) {
      if (min !== undefined && value < min) return false;
      if (max !== undefined && value > max) return false;
    }
    return true;
  }

  // 验证hint的合理性
  const validMin = isValidHint(min, max, value) ? min : undefined;
  const validMax = isValidHint(min, max, value) ? max : undefined;
  const validStep = step !== undefined && step > 0 ? step : undefined;

  // 如果全部都有且合理，就直接返回（转换为10的幂）
  if (validMin !== undefined && validMax !== undefined && validStep !== undefined) {
    const convertedMin = toPowerOfTen(validMin);
    const convertedMax = toPowerOfTen(validMax, true);
    const convertedStep = toPowerOfTen(validStep);

    // 确保 step 不会大于 min 的绝对值（当 min 不为 0 时）
    let finalStep = convertedStep;
    if (convertedMin !== 0 && Math.abs(convertedMin) < convertedStep) {
      finalStep = toPowerOfTen(Math.abs(convertedMin));
    }

    return {
      min: convertedMin,
      max: convertedMax,
      step: finalStep
    };
  }

  const absVal = Math.abs(value);
  const isZero = absVal < Number.EPSILON;
  const isNegative = value < 0;

  let estimatedMin: number;
  let estimatedMax: number;

  if (validMin !== undefined && validMax !== undefined) {
    // 两个边界都给定且合理
    estimatedMin = toPowerOfTen(validMin);
    estimatedMax = toPowerOfTen(validMax, true);
  } else if (validMin !== undefined) {
    // 只给定最小值
    estimatedMin = toPowerOfTen(validMin);
    if (isZero) {
      estimatedMax = toPowerOfTen(validMin + 10);
    } else {
      // 基于value和min确定max
      const range = Math.abs(value - validMin) * 10;
      estimatedMax = toPowerOfTen(Math.max(value, validMin) + range, true);
    }
  } else if (validMax !== undefined) {
    // 只给定最大值
    estimatedMax = toPowerOfTen(validMax, true);
    if (isZero) {
      estimatedMin = toPowerOfTen(validMax - 10);
    } else {
      // 基于value和max确定min
      const range = Math.abs(validMax - value) * 10;
      estimatedMin = toPowerOfTen(Math.min(value, validMax) - range);
    }
  } else {
    // 都没给定，基于value估计
    if (isZero) {
      estimatedMin = -1;
      estimatedMax = 1;
    } else if (isNegative) {
      // 负数情况：扩展到两个方向
      const magnitude = toPowerOfTen(absVal, true);
      estimatedMin = -magnitude * 10;
      estimatedMax = magnitude;
    } else {
      // 正数情况
      const magnitude = toPowerOfTen(value, true);
      estimatedMin = toPowerOfTen(value / 100);
      estimatedMax = magnitude * 10;
    }
  }

  // 确保 min < max
  if (estimatedMin >= estimatedMax) {
    if (isZero) {
      estimatedMin = -1;
      estimatedMax = 1;
    } else {
      const center = (estimatedMin + estimatedMax) / 2;
      const magnitude = Math.max(Math.abs(estimatedMin), Math.abs(estimatedMax));
      const powerMagnitude = toPowerOfTen(magnitude, true);
      estimatedMin = center - powerMagnitude;
      estimatedMax = center + powerMagnitude;
    }
  }

  // 估算步幅
  let estimatedStep: number;
  if (validStep !== undefined) {
    estimatedStep = toPowerOfTen(validStep);
  } else {
    const range = estimatedMax - estimatedMin;
    if (range === 0) {
      estimatedStep = isZero ? 0.1 : toPowerOfTen(Math.abs(value) / 100);
    } else {
      // 步幅通常是范围的1%到10%之间的10的幂
      const targetStep = range / 100;
      estimatedStep = toPowerOfTen(targetStep);
    }

    // 如果所有输入都是整数,确保步幅至少为1
    if (shouldUseInteger && estimatedStep < 1) {
      estimatedStep = 1;
    }
  }

  // 修正: 确保 step 不会大于 min 的绝对值（当 min 不为 0 时）
  if (estimatedMin !== 0 && Math.abs(estimatedMin) < estimatedStep) {
    estimatedStep = toPowerOfTen(Math.abs(estimatedMin));
  }

  // 同时也要确保 step 合理，不能太大导致无法在范围内滑动
  const range = estimatedMax - estimatedMin;
  if (estimatedStep > range / 2) {
    estimatedStep = toPowerOfTen(range / 100);
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
