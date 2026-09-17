# 로컬 전용 PlatformIO 설정

`firmware/platformio.ini` 의 `extra_configs = local/*.ini` 덕분에,
**`firmware/local/`** 에 넣은 `.ini` 파일은 자동으로 합쳐진다.
이 폴더는 `.gitignore` 에 들어 있어 커밋되지 않으므로,
사람마다 다른 설정(포트 이름, 사내 미러, 패키지 고정)을 여기에 둔다.

```bash
mkdir -p firmware/local
cp firmware/local.example/upload-port.ini firmware/local/
```

여기 있는 파일들은 **예시**다. 그대로는 동작하지 않을 수 있으니
자기 환경에 맞게 고쳐서 `firmware/local/` 로 복사할 것.
