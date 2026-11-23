# 보안 정책 / Security policy

보안 취약점을 발견하셨다면 **공개 이슈 대신** 이 레포의 **Security → Report a vulnerability**(비공개 취약점 신고)로 알려 주세요. 확인 후 답변드리고, 고친 버전을 릴리스하면서 함께 안내합니다.

If you find a security issue, please **do not open a public issue**. Use **Security → Report a vulnerability** in this repository to report it privately. We will reply after checking and announce the fix with a release.

listchange-probe 는 네트워크 포트를 열지 않습니다. `serve` 는 stdio 로만 통신하고 사용자가 고른 `--log` 파일에만 기록하며(도구 인자는 기록하지 않고 메서드와 항목 이름만 남깁니다), `report` 와 `demo` 는 오프라인으로 동작합니다. / listchange-probe opens no network port: `serve` talks over stdio and writes only the `--log` file you choose (method and item names only, never tool arguments); `report` and `demo` run offline.
