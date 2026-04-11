import requests
import json
import os

apiBase = "http://localhost:8000"
test_file = "C:\\Users\\NanBao\\Pictures\\Saved Pictures\\1.mp4"

def test():
    # 1. create project
    res = requests.post(f"{apiBase}/projects", json={
        "name": "Test project",
        "source_lang": "zh",
        "target_lang": "vi",
        "prompt": "Test",
        "glossary": "",
        "roi": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8}
    })
    print("Create project:", res.status_code, res.text)
    if res.status_code != 200:
        return
    proj_id = res.json()["id"]

    # 2. upload video
    if not os.path.exists(test_file):
        print("File does not exist")
        return
        
    print(f"Uploading file {test_file} to project {proj_id}")
    with open(test_file, 'rb') as f:
        res = requests.post(f"{apiBase}/projects/{proj_id}/upload", files={"file": f})
    print("Upload video:", res.status_code, res.text)

if __name__ == "__main__":
    test()
