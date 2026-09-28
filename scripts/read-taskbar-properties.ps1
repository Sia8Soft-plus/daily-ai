param([long]$Handle)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TaskbarProperties {
 [StructLayout(LayoutKind.Sequential)] public struct Key { public Guid format; public uint id; }
 [StructLayout(LayoutKind.Explicit, Size=24)] public struct Value { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr text; }
 [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 public interface Store {
  uint GetCount(); void GetAt(uint index, out Key key); void GetValue(ref Key key, out Value value);
  void SetValue(ref Key key, ref Value value); void Commit();
 }
 [DllImport("shell32.dll",PreserveSig=false)] static extern void SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out Store store);
 [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
 public static string Read(long hwnd, uint id) {
  Guid iid=new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); Store store;
  SHGetPropertyStoreForWindow(new IntPtr(hwnd),ref iid,out store);
  Value value=new Value();
  try { Key key=new Key {format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),id=id}; store.GetValue(ref key,out value); return value.type==31 ? Marshal.PtrToStringUni(value.text) : null; }
  finally { PropVariantClear(ref value); Marshal.ReleaseComObject(store); }
 }
}
'@
[pscustomobject]@{
 appId=[TaskbarProperties]::Read($Handle,5)
 iconResource=[TaskbarProperties]::Read($Handle,3)
 relaunchCommand=[TaskbarProperties]::Read($Handle,2)
 displayName=[TaskbarProperties]::Read($Handle,4)
} | ConvertTo-Json -Compress
