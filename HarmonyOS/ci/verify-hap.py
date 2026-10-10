import json,sys,zipfile,struct
with zipfile.ZipFile(sys.argv[1]) as z:
    names=z.namelist()
    assert 'ets/modules.abc' in names
    for name in ['waimedia','avformat','avcodec','avutil','swresample','swscale']:
        binary=z.read('libs/arm64-v8a/lib'+name+'.so')
        assert binary[:4]==b'\x7fELF' and struct.unpack_from('<H',binary,18)[0]==183, name
    assert b'libdav1d' in z.read('libs/arm64-v8a/libavcodec.so'), 'Missing compiled dav1d decoder'
    assert b'https' in z.read('libs/arm64-v8a/libavformat.so'), 'Missing HTTPS transport'
    assert any(n.endswith('/ca.pem') for n in names)
    assert not any(n.lower().endswith(('.p12','.p7b','.cer','.mobileprovision')) for n in names)
    config=json.loads(z.read('module.json'))
    app=config['app']
    assert app['bundleName']=='com.chatapp.bqimvip'
    assert app['versionName']=='1.0.0'
    assert app['minAPIVersion']==12
    print('PASS HAP: ArkTS bytecode, six ARM64 ELF libraries, dav1d, HTTPS, CA, API12, version 1.0.0')
