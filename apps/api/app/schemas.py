from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ROI(BaseModel):
    x: float = Field(default=0.1, ge=0, le=1)
    y: float = Field(default=0.75, ge=0, le=1)
    w: float = Field(default=0.8, ge=0.01, le=1)
    h: float = Field(default=0.2, ge=0.01, le=1)


class ProjectCreate(BaseModel):
    name: str
    source_lang: str = "zh"
    target_lang: str = "vi"
    roi: ROI = ROI()
    prompt: str = ""
    glossary: str = ""


class ProjectRead(BaseModel):
    id: str
    name: str
    source_lang: str
    target_lang: str
    status: str
    video_path: str | None
    roi: ROI
    prompt: str
    glossary: str

    model_config = {"from_attributes": True}


class ProjectUpdate(BaseModel):
    name: str | None = None
    source_lang: str | None = None
    target_lang: str | None = None
    roi: ROI | None = None
    prompt: str | None = None
    glossary: str | None = None


class SegmentRead(BaseModel):
    id: int
    start_sec: float
    end_sec: float
    raw_text: str
    translated_text: str
    speaker: str
    voice: str
    confidence: float

    model_config = {"from_attributes": True}


class SegmentUpdate(BaseModel):
    id: int
    start_sec: float
    end_sec: float
    raw_text: str
    translated_text: str
    speaker: str = "narrator"
    voice: str = "narrator-neutral"


class ExportRequest(BaseModel):
    export_format: str = "srt"  # srt|vtt|csv|txt|json
    content_mode: str = "translated"  # raw|translated|bilingual


class ExportResponse(BaseModel):
    output_key: str
    download_url: str
    output_path: str


class RetranslateRequest(BaseModel):
    gemini_api_key: str | None = None


class RetranslateResponse(BaseModel):
    translation_stats: dict[str, int]
    translation_error_hint: str
    segments: list[SegmentRead]


class PipelineStartRequest(BaseModel):
    input_mode: str = "video_ocr"  # video_ocr|audio_asr
    gemini_api_key: str | None = None
    voice_map: dict[str, str] = Field(default_factory=dict)
    scan_interval_sec: float = Field(default=1.5, ge=0.1, le=10.0)
    audio_provider: str = "whisper_cli"
    audio_asr_model: str = "base"
    audio_asr_language: str = "zh"
    audio_chunk_sec: int = Field(default=600, ge=60, le=3600)
    audio_chunk_overlap_sec: int = Field(default=4, ge=0, le=30)


class UrlIngestStartRequest(BaseModel):
    source_url: str
    auto_start_pipeline: bool = True
    input_mode: str = "video_ocr"
    gemini_api_key: str | None = None
    voice_map: dict[str, str] = Field(default_factory=dict)
    scan_interval_sec: float = Field(default=1.5, ge=0.1, le=10.0)
    audio_provider: str = "whisper_cli"
    audio_asr_model: str = "base"
    audio_asr_language: str = "zh"
    audio_chunk_sec: int = Field(default=600, ge=60, le=3600)
    audio_chunk_overlap_sec: int = Field(default=4, ge=0, le=30)


class DubStartRequest(BaseModel):
    srt_key: str = "manual.translated.srt"
    output_format: str = "wav"  # wav|mp3
    voice: str = "vi-VN-HoaiMyNeural"
    rate: str = "+0%"
    volume: str = "+0%"
    pitch: str = "+0Hz"
    match_video_duration: bool = True


class ClearSessionsRequest(BaseModel):
    include_processing: bool = False
    delete_storage: bool = True


class ClearSessionsResponse(BaseModel):
    deleted_projects: int
    deleted_project_ids: list[str]
    skipped_processing_projects: int
    removed_storage_dirs: int
    failed_storage_dirs: list[str]


class SrtUploadResponse(BaseModel):
    output_key: str
    output_path: str


class RetryJobsResponse(BaseModel):
    retried_count: int
    retried_from_job_ids: list[str]
    created_job_ids: list[str]
    skipped_count: int


class JobRead(BaseModel):
    id: str
    project_id: str
    status: str
    progress: int
    step: str
    error_message: str
    artifacts: Any
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
