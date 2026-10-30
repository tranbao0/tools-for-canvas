/**
 * `true` only in builds of the Firefox test channel and in the end-to-end build. The build
 * replaces it with a literal, so a store build drops every branch that it guards.
 */
declare const __FILE_CHECK__: boolean;
