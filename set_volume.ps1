param([Parameter(Mandatory = $true)][int]$Percent)

$Percent = [Math]::Max(0, [Math]::Min(100, $Percent))

$code = @"
using System;
using System.Runtime.InteropServices;

public class Vol {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorCom { }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams,
      [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  }

  [Guid("5CDF2C82-841E-4546-9722-0CF740782BAF"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr p);
    int UnregisterControlChangeNotify(IntPtr p);
    int GetChannelCount(out uint pn);
    int SetMasterVolumeLevel(float f, Guid p);
    [PreserveSig] int SetMasterVolumeLevelScalar(float f, Guid p);
    int GetMasterVolumeLevel(out float pf);
    int GetMasterVolumeLevelScalar(out float pf);
    int SetChannelVolumeLevel(uint n, float f, Guid p);
    int SetChannelVolumeLevelScalar(uint n, float f, Guid p);
    int GetChannelVolumeLevel(uint n, out float pf);
    int GetChannelVolumeLevelScalar(uint n, out float pf);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMuted, Guid p);
    int GetMute(out bool pb);
  }

  public static void Set(float scalar) {
    var enumerator = (IMMDeviceEnumerator)(object)new MMDeviceEnumeratorCom();
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out o));
    var vol = (IAudioEndpointVolume)o;
    Guid g = Guid.Empty;
    Marshal.ThrowExceptionForHR(vol.SetMute(false, g));
    Marshal.ThrowExceptionForHR(vol.SetMasterVolumeLevelScalar(scalar, g));
  }
}
"@

try { Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue | Out-Null } catch {}

try {
  [Vol]::Set($Percent / 100.0)
  exit 0
} catch {
  exit 1
}
