from __future__ import annotations
from typing import Literal, Any
from pydantic import BaseModel, Field, ConfigDict, model_validator

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Ref(StrictModel):
    kind: Literal['dataset','artifact']
    id: str = Field(min_length=1,max_length=256)
    member: str | None = None

    @model_validator(mode='after')
    def member_for_artifact(self):
        if self.kind == 'artifact' and not self.member:
            raise ValueError('Artifact member is required.')
        if self.kind == 'dataset' and self.member:
            raise ValueError('Dataset references have no member.')
        return self

class Inspect(StrictModel):
    operation: Literal['inventory','profile','job','ensemble','raster_compare','table_compare']
    ref: Ref | None = None
    other: Ref | None = None
    object_id: str | None = None
    band: int = Field(default=1,ge=1)
    keys: list[str] = Field(default_factory=list)
    observed_column: str = 'observed_sediment'
    predicted_column: str = 'predicted_sediment'

class Action(StrictModel):
    kind: Literal['analyze_collection','calibration','run_job','ensemble']
    refs: list[Ref] = Field(default_factory=list)
    job_id: str | None = None
    observed: Ref | None = None
    predicted: Ref | None = None
    time_column: str = 'date'
    observed_column: str = 'observed_sediment'
    predicted_column: str = 'predicted_sediment'
    observed_unit: str | None = None
    predicted_unit: str | None = None
    holdout_fraction: float = Field(default=0.25,ge=0.1,le=0.5)
    min_points: int = Field(default=8,ge=8)
    area_ha: float | None = Field(default=None,gt=0)
    native_experiment_id: str | None = Field(default=None,pattern=r'^[0-9a-f]{64}$')
    parameter_grid: dict[str,list[Any]] = Field(default_factory=dict)
    max_members: int = Field(default=64,ge=1)
    retain_member_rasters: bool = True

    @model_validator(mode='after')
    def original_experiment_kind(self):
        if self.native_experiment_id is not None and self.kind != 'ensemble':
            raise ValueError('A native experiment ID belongs to the ensemble action.')
        return self

class SessionCreate(StrictModel):
    title: str = Field(default='Watershed investigation',min_length=1,max_length=240)

class Ask(StrictModel):
    question: str = Field(min_length=1,max_length=24000)
    request_id: str = Field(min_length=1,max_length=128)
