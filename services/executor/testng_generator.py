import os
import re
import logging

logger = logging.getLogger("executor.testng")


def _find_class(method_name: str, tests_dir: str) -> str | None:
    if not os.path.exists(tests_dir):
        return None
    for fname in os.listdir(tests_dir):
        if not fname.endswith(".java"):
            continue
        fpath = os.path.join(tests_dir, fname)
        with open(fpath) as f:
            content = f.read()
        if re.search(r'public\s+void\s+' + re.escape(method_name) + r'\s*\(', content):
            class_name = fname.replace(".java", "")
            return f"tests.generated.{class_name}"
    return None


def generate(selected_tests: list[str], java_dir: str, run_id: str, app_id: str) -> str:
    tests_dir = os.path.join(java_dir, "src", "test", "java", "tests", "generated")
    class_methods: dict[str, list[str]] = {}

    for method in selected_tests:
        cls = _find_class(method, tests_dir)
        if cls:
            class_methods.setdefault(cls, []).append(method)
        else:
            logger.warning(f"Could not find class for method: {method}")

    classes_xml = ""
    for cls, methods in class_methods.items():
        methods_xml = "\n".join(f"          <include name=\"{m}\"/>" for m in methods)
        classes_xml += (
            f"      <class name=\"{cls}\">\n"
            f"        <methods>\n{methods_xml}\n        </methods>\n"
            f"      </class>\n"
        )

    xml = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<!DOCTYPE suite SYSTEM "https://testng.org/testng-1.0.dtd">\n'
        f'<suite name="Run_{run_id}" verbose="1">\n'
        f'  <test name="{app_id}">\n'
        f'    <classes>\n{classes_xml}    </classes>\n'
        f'  </test>\n'
        f'</suite>\n'
    )

    out_path = os.path.join(java_dir, "testng.xml")
    with open(out_path, "w") as f:
        f.write(xml)
    logger.info(f"Generated testng.xml for run {run_id}: {len(selected_tests)} tests")
    return out_path
