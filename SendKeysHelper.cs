using System;
using System.Runtime.InteropServices;
using System.Threading;

class Program
{
    [DllImport("user32.dll", SetLastError = true)]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    // Virtual Key codes
    const byte VK_CONTROL = 0x11;
    const byte VK_C = 0x43;
    const byte VK_V = 0x56;
    const byte VK_MENU = 0x12; // Alt
    const byte VK_SHIFT = 0x10;
    const byte VK_LWIN = 0x5B;

    const uint KEYEVENTF_KEYUP = 0x0002;

    static void Main(string[] args)
    {
        // 1. Force release of modifiers that are currently held down (because the user just pressed Ctrl+Alt+L)
        keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);

        Thread.Sleep(50); // slight delay to let OS register the modifier releases

        if (args.Length > 0 && args[0] == "copy") {
            keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero); // Ctrl down
            keybd_event(VK_C, 0, 0, UIntPtr.Zero); // C down
            Thread.Sleep(50);
            keybd_event(VK_C, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // C up
            keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // Ctrl up
        } 
        else if (args.Length > 0 && args[0] == "paste") {
            keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero); // Ctrl down
            keybd_event(VK_V, 0, 0, UIntPtr.Zero); // V down
            Thread.Sleep(50);
            keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // V up
            keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); // Ctrl up
        }
    }
}
