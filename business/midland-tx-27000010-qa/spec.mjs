// MIT. Literal field/type/nullability/length/domain/numeric-definition transcription of City of Midland RFP 27000010,
// sections 4.5.1-4.5.5. Verify against the original bidder addenda before any proposal or delivery.
// Source: https://govtribe.com/file/government-file/001-rfp-27000010-lidar-geospatial-data-acquisition-dot-pdf
const field = (name, type, nullable=false, length=null, domain=null) => ({name,type,nullable,...(length?{length}:{}),...(domain?{domain}: {})});
const O=()=>field('OBJECTID','OID');
const G=()=>field('SHAPE','Geometry');
const I=(name,nullable=false,domain=null)=>field(name,'Integer',nullable,null,domain);
const S=(name,nullable=false,domain=null)=>field(name,'SmallInteger',nullable,null,domain);
const D=(name,nullable=false,scale=4)=>({...field(name,'Double',nullable),precision:38,scale});
const T=(name,length,nullable=false,domain=null)=>field(name,'String',nullable,length,domain);
const Date=(name,nullable=false)=>field(name,'Date',nullable);
export const RFP={
  solicitation:'27000010',buyer:'City of Midland, Texas',published_source_sections:'4.5.1–4.5.5',
  source:'https://govtribe.com/file/government-file/001-rfp-27000010-lidar-geospatial-data-acquisition-dot-pdf',
  official_portal:'https://midlandtexas.bonfirehub.com/opportunities/250058',
  expected_parcels:67455,
  horizontal_crs:'TX State Plane Central (NAD83 2011)',
  classes:{
    IMP_SURFACE_AOI:{geometry:'Polygon',fields:[O(),G(),I('FEAT_ID'),S('SURF_CLASS',false,[1,2]),T('SURF_DESC',50,true),T('SURF_SUBCLASS',50,true),D('AREA_SQFT'),D('AREA_ACRES',false,6),Date('CAPTURE_DATE'),S('CAPTURE_YEAR'),T('METHOD',100),T('SOURCE_DATA',100),T('VENDOR',100),T('PROJECT_ID',50)]},
    IMP_SURFACE_PARCELS:{geometry:'Polygon',fields:[O(),G(),T('PARCEL_ID',30),D('PARCEL_AREA_SQFT'),D('PARCEL_AREA_ACRES',false,6),D('IMP_AREA_SQFT'),D('IMP_AREA_ACRES',false,6),D('PERV_AREA_SQFT'),D('PERV_AREA_ACRES',false,6),D('IMP_PCT'),D('IMP_ERU',true),Date('CAPTURE_DATE'),S('CAPTURE_YEAR'),T('METHOD',100),S('QA_FLAG',true,[0,1,2]),T('QA_NOTES',255,true)]},
    CONTOURS_1FT:{geometry:'Polyline',vertical_crs:'NAVD88',fields:[O(),G(),D('ELEV_FT'),T('CONTOUR_TYPE',20,false,['Index','Intermediate']),T('SOURCE_DEM',100),S('CAPTURE_YEAR')]},
    LIDAR_FLIGHTLINES:{geometry:'Polygon',fields:[O(),G(),T('FLIGHTLINE_ID',50),Date('ACQ_DATE'),Date('ACQ_START',true),Date('ACQ_END',true),D('ALTITUDE_FT',true,2),D('OVERLAP_PCT',true,2),D('AVG_PTS_M2',true,2),T('SENSOR',100)]}
  }
};
export const SUPPORTED=new Set(Object.keys(RFP.classes));
