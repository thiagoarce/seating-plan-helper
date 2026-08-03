/**
 * Compile-time only helpers.
 *
 * `AssertExtends` lets a module state "this inferred type still matches the
 * hand-written domain interface" without any runtime cost. If the two drift
 * apart, `tsc` fails at the assertion site instead of somewhere far downstream.
 */

export type AssertExtends<A extends B, B> = A extends B ? true : never;
