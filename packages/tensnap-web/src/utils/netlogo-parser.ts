// netlogo-parser.ts

interface BaseWidget {
  type: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface GraphicsWindow extends BaseWidget {
  type: 'GRAPHICS-WINDOW';
  patchSize: number;
  fontSize: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  shapesVisible: boolean;
  tickCounterVisible: boolean;
  frameRate: number;
}

interface Button extends BaseWidget {
  type: 'BUTTON';
  display: string;
  code: string;
  forever: boolean;
  buttonType: 'Observer' | 'Turtle' | 'Patch' | 'Link';
  actionKey?: string;
  disableUntilTicksStart: boolean;
}

interface Slider extends BaseWidget {
  type: 'SLIDER';
  display: string;
  variable: string;
  min: number;
  max: number;
  defaultValue: number;
  step: number;
  units?: string;
  horizontal: boolean;
}

interface Switch extends BaseWidget {
  type: 'SWITCH';
  display: string;
  variable: string;
  defaultValue: boolean;
}

interface Chooser extends BaseWidget {
  type: 'CHOOSER';
  display: string;
  variable: string;
  choices: string[];
  defaultIndex: number;
}

interface InputBox extends BaseWidget {
  type: 'INPUTBOX';
  variable: string;
  defaultValue: string | number;
  inputType: 'String' | 'Number' | 'String (reporter)' | 'Number (reporter)' | 'Color';
  multiline: boolean;
}

interface Monitor extends BaseWidget {
  type: 'MONITOR';
  display: string;
  reporter: string;
  precision: number;
  fontSize: number;
}

interface Plot extends BaseWidget {
  type: 'PLOT';
  display: string;
  xAxis: string;
  yAxis: string;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  autoPlotOn: boolean;
  legendOn: boolean;
  setupCode: string;
  updateCode: string;
  pens: PlotPen[];
}

interface PlotPen {
  display: string;
  interval: number;
  mode: number;
  color: number;
  inLegend: boolean;
  setupCode: string;
  updateCode: string;
}

interface Output extends BaseWidget {
  type: 'OUTPUT';
  fontSize: number;
}

interface TextBox extends BaseWidget {
  type: 'TEXTBOX';
  display: string;
  fontSize: number;
  color: number;
  transparent: boolean;
}

type Widget =
  | GraphicsWindow
  | Button
  | Slider
  | Switch
  | Chooser
  | InputBox
  | Monitor
  | Plot
  | Output
  | TextBox;

interface NetLogoModel {
  widgets: Widget[];
  version: string;
}

/**
 * Parse interface widgets and the version from a NetLogo model file.
 * @param content Complete model file text.
 * @returns Parsed widgets and version; absent interfaces produce an empty widget list.
 */
export function parseNetLogoFile(content: string): NetLogoModel {
  const sections = splitSections(content);
  const widgetSection = findWidgetSection(sections);
  const version = extractVersion(content);

  if (!widgetSection) {
    return { widgets: [], version };
  }

  const widgets = parseWidgets(widgetSection);
  return { widgets, version };
}

function splitSections(content: string): string[] {
  return content.split('@#$#@#$#@');
}

function findWidgetSection(sections: string[]): string | null {
  // The interface is the second section of the NetLogo file.
  return sections.length > 1 ? sections[1] : null;
}

function extractVersion(content: string): string {
  const versionMatch = content.match(/NetLogo\s+([\d.]+)/i);
  return versionMatch ? versionMatch[1] : 'unknown';
}

function parseWidgets(widgetSection: string): Widget[] {
  const widgets: Widget[] = [];
  const lines = widgetSection
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line);

  let i = 0;
  while (i < lines.length) {
    const widgetType = lines[i];

    try {
      const result = parseWidget(widgetType, lines, i);
      if (result) {
        widgets.push(result.widget);
        i = result.nextIndex;
      } else {
        i++;
      }
    } catch (error) {
      console.warn(`Failed to parse widget at line ${i}:`, error);
      i++;
    }
  }

  return widgets;
}

function parseWidget(
  widgetType: string,
  lines: string[],
  startIndex: number,
): { widget: Widget; nextIndex: number } | null {
  switch (widgetType) {
    case 'GRAPHICS-WINDOW':
      return parseGraphicsWindow(lines, startIndex);
    case 'BUTTON':
      return parseButton(lines, startIndex);
    case 'SLIDER':
      return parseSlider(lines, startIndex);
    case 'SWITCH':
      return parseSwitch(lines, startIndex);
    case 'CHOOSER':
      return parseChooser(lines, startIndex);
    case 'INPUTBOX':
      return parseInputBox(lines, startIndex);
    case 'MONITOR':
      return parseMonitor(lines, startIndex);
    case 'PLOT':
      return parsePlot(lines, startIndex);
    case 'OUTPUT':
      return parseOutput(lines, startIndex);
    case 'TEXTBOX':
      return parseTextBox(lines, startIndex);
    default:
      return null;
  }
}

function parseGraphicsWindow(
  lines: string[],
  start: number,
): { widget: GraphicsWindow; nextIndex: number } {
  const widget: GraphicsWindow = {
    type: 'GRAPHICS-WINDOW',
    left: parseInt(lines[start + 1]),
    top: parseInt(lines[start + 2]),
    right: parseInt(lines[start + 3]),
    bottom: parseInt(lines[start + 4]),
    patchSize: parseFloat(lines[start + 5]),
    fontSize: parseInt(lines[start + 6]),
    minX: parseInt(lines[start + 9]),
    maxX: parseInt(lines[start + 10]),
    minY: parseInt(lines[start + 11]),
    maxY: parseInt(lines[start + 12]),
    shapesVisible: lines[start + 13] === '1',
    tickCounterVisible: lines[start + 14] === '1',
    frameRate: parseFloat(lines[start + 15]),
  };
  return { widget, nextIndex: start + 16 };
}

function parseButton(lines: string[], start: number): { widget: Button; nextIndex: number } {
  const widget: Button = {
    type: 'BUTTON',
    left: parseInt(lines[start + 1]),
    top: parseInt(lines[start + 2]),
    right: parseInt(lines[start + 3]),
    bottom: parseInt(lines[start + 4]),
    display: lines[start + 5],
    code: lines[start + 6],
    forever: lines[start + 7] === 'T',
    buttonType: lines[start + 8] as any,
    disableUntilTicksStart: lines[start + 10] === '1',
  };

  if (lines[start + 9] && lines[start + 9] !== 'NIL') {
    widget.actionKey = lines[start + 9];
  }

  return { widget, nextIndex: start + 11 };
}

function parseSlider(lines: string[], start: number): { widget: Slider; nextIndex: number } {
  const widget: Slider = {
    type: 'SLIDER',
    left: parseInt(lines[start + 1]),
    top: parseInt(lines[start + 2]),
    right: parseInt(lines[start + 3]),
    bottom: parseInt(lines[start + 4]),
    display: lines[start + 5],
    variable: lines[start + 6],
    min: parseFloat(lines[start + 7]),
    max: parseFloat(lines[start + 8]),
    defaultValue: parseFloat(lines[start + 9]),
    step: parseFloat(lines[start + 10]),
    horizontal: lines[start + 12] === 'HORIZONTAL',
  };

  if (lines[start + 11] && lines[start + 11] !== 'NIL') {
    widget.units = lines[start + 11];
  }

  return { widget, nextIndex: start + 13 };
}

function parseSwitch(lines: string[], start: number): { widget: Switch; nextIndex: number } {
  const widget: Switch = {
    type: 'SWITCH',
    left: parseInt(lines[start + 1]),
    top: parseInt(lines[start + 2]),
    right: parseInt(lines[start + 3]),
    bottom: parseInt(lines[start + 4]),
    display: lines[start + 5],
    variable: lines[start + 6],
    defaultValue: lines[start + 7] === '0',
  };

  return { widget, nextIndex: start + 9 };
}

function parseChooser(lines: string[], start: number): { widget: Chooser; nextIndex: number } {
  const widget: Chooser = {
    type: 'CHOOSER',
    left: parseInt(lines[start + 1]),
    top: parseInt(lines[start + 2]),
    right: parseInt(lines[start + 3]),
    bottom: parseInt(lines[start + 4]),
    display: lines[start + 5],
    variable: lines[start + 6],
    choices: parseChoices(lines[start + 7]),
    defaultIndex: parseInt(lines[start + 8]),
  };

  return { widget, nextIndex: start + 9 };
}

function parseChoices(choiceString: string): string[] {
  const cleaned = choiceString.replace(/^["']|["']$/g, '').trim();
  return cleaned.split(/\s+/).filter((c) => c);
}

function parseInputBox(lines: string[], start: number): { widget: InputBox; nextIndex: number } {
  const widget: InputBox = {
    type: 'INPUTBOX',
    left: parseInt(lines[start + 1]),
    top: parseInt(lines[start + 2]),
    right: parseInt(lines[start + 3]),
    bottom: parseInt(lines[start + 4]),
    variable: lines[start + 5],
    defaultValue: parseInputValue(lines[start + 6]),
    inputType: lines[start + 8] as any,
    multiline: lines[start + 7] === '1',
  };

  return { widget, nextIndex: start + 9 };
}

function parseInputValue(value: string): string | number {
  const numValue = parseFloat(value);
  return isNaN(numValue) ? value : numValue;
}

function parseMonitor(lines: string[], start: number): { widget: Monitor; nextIndex: number } {
  const widget: Monitor = {
    type: 'MONITOR',
    left: parseInt(lines[start + 1]),
    top: parseInt(lines[start + 2]),
    right: parseInt(lines[start + 3]),
    bottom: parseInt(lines[start + 4]),
    display: lines[start + 5],
    reporter: lines[start + 6],
    precision: parseInt(lines[start + 7]),
    fontSize: parseInt(lines[start + 9]),
  };

  return { widget, nextIndex: start + 10 };
}

function parsePlot(lines: string[], start: number): { widget: Plot; nextIndex: number } {
  let index = start;

  const widget: Plot = {
    type: 'PLOT',
    left: parseInt(lines[++index]),
    top: parseInt(lines[++index]),
    right: parseInt(lines[++index]),
    bottom: parseInt(lines[++index]),
    display: lines[++index],
    xAxis: lines[++index],
    yAxis: lines[++index],
    xmin: parseFloat(lines[++index]),
    xmax: parseFloat(lines[++index]),
    ymin: parseFloat(lines[++index]),
    ymax: parseFloat(lines[++index]),
    autoPlotOn: lines[++index] === 'true',
    legendOn: lines[++index] === 'true',
    setupCode: lines[++index] || '',
    updateCode: lines[++index] || '',
    pens: [],
  };

  index++;
  const penCount = parseInt(lines[index] || '0');
  index++;

  for (let i = 0; i < penCount; i++) {
    const pen: PlotPen = {
      display: lines[index++] || '',
      interval: parseFloat(lines[index++] || '1'),
      mode: parseInt(lines[index++] || '0'),
      color: parseInt(lines[index++] || '0'),
      inLegend: lines[index++] === 'true',
      setupCode: lines[index++] || '',
      updateCode: lines[index++] || '',
    };
    widget.pens.push(pen);
  }

  return { widget, nextIndex: index };
}

function parseOutput(lines: string[], start: number): { widget: Output; nextIndex: number } {
  const widget: Output = {
    type: 'OUTPUT',
    left: parseInt(lines[start + 1]),
    top: parseInt(lines[start + 2]),
    right: parseInt(lines[start + 3]),
    bottom: parseInt(lines[start + 4]),
    fontSize: parseInt(lines[start + 5]),
  };

  return { widget, nextIndex: start + 6 };
}

function parseTextBox(lines: string[], start: number): { widget: TextBox; nextIndex: number } {
  const widget: TextBox = {
    type: 'TEXTBOX',
    left: parseInt(lines[start + 1]),
    top: parseInt(lines[start + 2]),
    right: parseInt(lines[start + 3]),
    bottom: parseInt(lines[start + 4]),
    display: lines[start + 5],
    fontSize: parseInt(lines[start + 6]),
    color: parseFloat(lines[start + 7]),
    transparent: lines[start + 8] === '1',
  };

  return { widget, nextIndex: start + 9 };
}
