import { useCanvas } from '@leafer-ui/node';
import * as nodeCanvas from 'canvas';

const RUNTIME_FLAG = '__tensnapLeaferNodeRuntimeInitialized__';

const runtimeScope = globalThis as typeof globalThis & {
	[RUNTIME_FLAG]?: boolean;
};

if (!runtimeScope[RUNTIME_FLAG]) {
	useCanvas('napi', nodeCanvas);
	runtimeScope[RUNTIME_FLAG] = true;
}