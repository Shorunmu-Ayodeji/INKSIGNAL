// The XMTP browser SDK persists to OPFS through a VFS that allows only one
// connection, so only one tab may run a client at a time.
export async function acquireTabLock(name: string): Promise<(() => void) | null> {
  if (!("locks" in navigator)) return () => {};

  return new Promise((resolve) => {
    void navigator.locks.request(name, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return;
      }
      return new Promise<void>((release) => {
        resolve(() => release());
      });
    });
  });
}
