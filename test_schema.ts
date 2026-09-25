import { DEFAULT_FORM_SCHEMA } from './src/forms/default-schema';
console.log(DEFAULT_FORM_SCHEMA.sections.map(s => ({key: s.key, route: s.route})));
