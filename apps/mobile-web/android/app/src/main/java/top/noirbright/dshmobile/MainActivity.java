package top.noirbright.dshmobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureVaultPlugin.class);
        registerPlugin(CameraPermissionPlugin.class);
        registerPlugin(DshSystemBarsPlugin.class);
        registerPlugin(DshBackgroundConnectionPlugin.class);
        registerPlugin(DshDeviceIdentityPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
