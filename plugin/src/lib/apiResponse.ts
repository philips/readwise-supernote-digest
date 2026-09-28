/**
 * The installed `sn-plugin-lib` .d.ts under-declares most SDK method return types as
 * `Promise<Object | null | undefined>` rather than the `Promise<APIResponse<T>>` shape the
 * live docs (docs.supernote.com) document and that the SDK actually returns at runtime
 * (confirmed via Task 1's on-device testing of PluginManager calls, which follow this same
 * shape). Cast SDK call results through this type rather than trusting the loose .d.ts.
 */
export interface APIResponse<T> {
  success: boolean;
  result?: T;
  error?: {message: string};
}
