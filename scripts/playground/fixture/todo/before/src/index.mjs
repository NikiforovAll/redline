import { formatList } from './format.mjs';
import { add, complete } from './store.mjs';

add('write the fixture');
add('open a round');
complete(1);
console.log(formatList());
