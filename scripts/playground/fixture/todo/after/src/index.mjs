import { formatList } from './format.mjs';
import { add, complete } from './store.mjs';

add('write the fixture');
add('open a round', '2026-01-31');
complete(1);
console.log(formatList());
