// Thin user CLI over study code shared with the benchmark kernel. This split
// prevents trial-loop drift; it is not required structure for a small JS app.
import {
  formatSchellingStudyCsv,
  parseSchellingStudyOptions,
  runSchellingStudy,
} from '../standalone/schelling-study';

const options = parseSchellingStudyOptions(process.argv.slice(2));
process.stdout.write(formatSchellingStudyCsv(runSchellingStudy(options)));
