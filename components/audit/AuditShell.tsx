"use client";

// 첫 화면 틀: 점검 세트를 고르기 전에는 고르는 화면, 고른 뒤에는 그 세트의 점검 화면을 보여 준다.
// 점검 화면을 떠나면(세트 바꾸기) 작업자와 읽어 둔 파일·결과는 모두 사라진다 (저장하지 않는 원칙).

import { useState } from "react";
import type { CheckSetInfo } from "@/lib/audit/checksets";
import AuditApp from "./AuditApp";
import CheckSetPicker from "./CheckSetPicker";
import Intro from "./Intro";

export default function AuditShell() {
  const [checkSet, setCheckSet] = useState<CheckSetInfo | null>(null);
  return (
    <>
      <Intro />
      {checkSet ? (
        <AuditApp key={checkSet.id} checkSet={checkSet} onBack={() => setCheckSet(null)} />
      ) : (
        <CheckSetPicker onPick={setCheckSet} />
      )}
    </>
  );
}
